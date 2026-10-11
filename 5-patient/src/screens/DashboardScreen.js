import RequestError from '../components/RequestError';
import {useScreenRefresh} from '../useScreenRefresh';
import {localDateKey, calendarDateKey, upcomingAppointments} from '../calendar';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Animated, Linking, Alert, Image, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { auth } from '../firebase/config';
import { apiFetch, getResidentId, clearCache } from '../apiHelper';
import CareArtwork from '../components/CareArtwork';
import WellnessTrend from '../components/WellnessTrend';
import { wellnessScore, wellnessStyle, colomboDay } from '../careSummary';
import { unregisterPushNotifications } from '../pushNotifications';

const DashboardScreen = ({ navigation }) => {
  const [patientName, setPatientName] = useState('Patient');
  const [caretakers, setCaretakers] = useState([]);
  const [loadingCaretakers, setLoadingCaretakers] = useState(true);
  const [notifications, setNotifications] = useState([]);
  const [todayAppointments, setTodayAppointments] = useState([]);
  const [sosSending, setSosSending] = useState(false);
  const [sosSent, setSosSent] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [resident, setResident] = useState(null);
  const [takenCount, setTakenCount] = useState(0);
  const [nextAppointment, setNextAppointment] = useState(null);
  const sosLock = useRef(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const sosPulse = useRef(new Animated.Value(1)).current;

  const fetchDashboard = useCallback(async () => {
    try {
      setLoadError(null);
      const user = auth.currentUser;
      if (!user) throw new Error('Please sign in again');
      setPatientName(user.displayName?.split(' ')[0] || 'Patient');
      const residentId = await getResidentId();
      const base='/residents/'+encodeURIComponent(residentId),day=colomboDay();
      const endpoints = [
        { key: 'care', url: base + '/caretakers' },
        { key: 'notices', url: base + '/notifications' },
        { key: 'appointments', url: base + '/appointments' },
        { key: 'details', url: base },
        { key: 'doses', url: base + '/medication-reminders?day=' + day },
        { key: 'events', url: base + '/medication-events?day=' + day }
      ];
      const results = await Promise.allSettled(endpoints.map(async e => {
        const res = await apiFetch(e.url);
        if (!res.ok) throw new Error(`${e.key} unavailable`);
        return { key: e.key, data: await res.json() };
      }));
      if (auth.currentUser?.uid !== user.uid) return;
      let feedErrorCount = 0;
      let dosesData = null, eventsData = null;
      for (const r of results) {
        if (r.status === 'fulfilled') {
          const { key, data } = r.value;
          if (key === 'care') setCaretakers(data);
          else if (key === 'notices') setNotifications(data.filter(notice => !notice.is_read));
          else if (key === 'details') { setResident(data); setPatientName(data.name?.split(' ')[0] || 'Patient'); }
          else if (key === 'appointments') {
            setNextAppointment(upcomingAppointments(data)[0] || null);
            setTodayAppointments(upcomingAppointments(data).filter(appointment => calendarDateKey(appointment.appointment_date) === localDateKey()));
          }
          else if (key === 'doses') dosesData = data;
          else if (key === 'events') eventsData = data;
        } else {
          feedErrorCount++;
        }
      }
      if (dosesData || eventsData) {
        const doses = dosesData || [];
        const events = eventsData || [];
        setTakenCount(doses.filter(dose => dose.status === 'taken').length + events.filter(event => event.status === 'taken' && !doses.some(dose => Number(dose.medication_id) === Number(event.medication_id))).length);
      }
      if (feedErrorCount > 0 && results[3].status !== 'fulfilled') {
        setLoadError('Some care updates could not be loaded. Showing latest available data.');
      } else {
        setLoadError(null);
      }
    } catch (error) { setLoadError('Your care updates could not be loaded. Check your connection and try again.'); }
    finally { setLoadingCaretakers(false); }
  }, []);
  useScreenRefresh(navigation, fetchDashboard);
  useEffect(()=>{const timer=setInterval(fetchDashboard,15000);return ()=>clearInterval(timer);},[fetchDashboard]);
  useEffect(() => {
    Animated.parallel([Animated.timing(fadeAnim,{toValue:1,duration:600,useNativeDriver:true}),Animated.timing(slideAnim,{toValue:0,duration:600,useNativeDriver:true})]).start();
    const pulse=Animated.loop(Animated.sequence([Animated.timing(sosPulse,{toValue:1.08,duration:1000,useNativeDriver:true}),Animated.timing(sosPulse,{toValue:1,duration:1000,useNativeDriver:true})]));
    pulse.start(); return () => pulse.stop();
  }, []);

  const handleLogout = async () => {
    try {
      clearCache();
      const leavingUser = auth.currentUser;
      await unregisterPushNotifications().catch(() => {});
      if (auth.currentUser?.uid !== leavingUser?.uid) return;
      await auth.signOut();
      navigation.replace('Login');
    } catch (error) {
      console.error(error);
    }
  };

  const handleCallCaretaker = (phone, name) => {
    if (!phone) {
      Alert.alert('No Phone Number', 'This caretaker has no phone number registered.');
      return;
    }
    const cleaned = phone.replace(/[^0-9+]/g, '');
    Alert.alert(
      'Call Caretaker',
      `Do you want to call ${name}?\n${phone}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Call', onPress: () => Linking.openURL(`tel:${cleaned}`) },
      ]
    );
  };

  const handleEmailCaretaker = (email, name) => {
    if (!email) return;
    Linking.openURL(`mailto:${email}?subject=Patient%20Message&body=Hi%20${name},%0A%0A`);
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  const dismissNotification = async (notifId) => {
    try {
      const response = await apiFetch(`/notifications/${notifId}/read`, { method: 'PUT' });
      if (!response.ok) throw new Error('Could not dismiss notification');
      setNotifications(prev => prev.filter(n => n.notification_id !== notifId));
    } catch (err) {
      Alert.alert('Could Not Dismiss', 'The notification was not saved as read. Please try again.');
    }
  };

  const handleSOS = () => {
    const title = '🚨 Emergency SOS';
    const message = 'This will send an immediate emergency alert to all administrators and your caretaker. Are you sure?';
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) {
        triggerSOS();
      }
      return;
    }
    Alert.alert(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'SEND SOS', style: 'destructive', onPress: triggerSOS },
      ]
    );
  };

  const triggerSOS = async () => {
    if (sosLock.current) return;
    sosLock.current = true;
    setSosSending(true);
    try {
      const residentId = await getResidentId();
      const res = await apiFetch('/sos-alerts', {
        method: 'POST',
        body: JSON.stringify({
          residentId,
          residentName: patientName,
          message: 'Emergency SOS triggered by patient'
        })
      });
      if (res.ok) {
        setSosSent(true);
        const sentMsg = 'Your emergency has been recorded for your care team. Call your caretaker or emergency services if you need immediate help.';
        Alert.alert('✅ SOS Sent', sentMsg);
        setTimeout(() => setSosSent(false), 30000); // Reset after 30s
      } else {
        const errMsg = 'Failed to send SOS. Please try again or call your caretaker directly.';
        Alert.alert('Error', errMsg);
      }
    } catch (err) {
      console.error('[SOS] Error:', err);
      const errMsg = 'Network error. Please call your caretaker directly.';
      Alert.alert('Error', errMsg);
    } finally {
      sosLock.current = false;
      setSosSending(false);
    }
  };

  const FeatureCard = ({ title, icon, color, subtitle, onPress }) => (
    <TouchableOpacity style={[styles.card, { borderLeftColor: color }]} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.iconContainer, { backgroundColor: color + '18' }]}>
        <MaterialCommunityIcons name={icon} size={30} color={color} />
      </View>
      <View style={styles.cardContent}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardSubtitle}>{subtitle}</Text>
      </View>
      <View style={[styles.chevronCircle, { backgroundColor: color + '12' }]}>
        <MaterialCommunityIcons name="chevron-right" size={20} color={color} />
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <Animated.ScrollView 
        contentContainerStyle={styles.scrollContainer} 
        showsVerticalScrollIndicator={false}
        style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}
      >
        
        {/* Header with gradient background */}
        <View style={styles.headerWrapper}>
          <View pointerEvents="none" style={styles.headerGlow} />
          <View style={styles.brandRow}><View style={styles.brandMark}><MaterialCommunityIcons name="heart-plus" size={21} color="#FFFFFF" /></View><Text style={styles.brandEyebrow}>CareConnect.</Text><View style={styles.patientPill}><Text style={styles.patientPillText}>YOUR SPACE</Text></View></View>
          <View style={styles.header}>
            <View>
              <Text style={styles.greeting}>{getGreeting()} 👋</Text>
              <Text style={styles.userName}>{patientName}</Text>
            </View>
            <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn} activeOpacity={0.7}>
              <MaterialCommunityIcons name="logout-variant" size={22} color="#EEE9FF" />
            </TouchableOpacity>
          </View>
          <View style={styles.heroContent}>
            <View style={styles.heroOrb} />
            <CareArtwork style={styles.heroArtwork} />
            <View style={styles.heartSticker}><MaterialCommunityIcons name="heart" size={24} color="#171459" /></View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroHeadline}>A little care.{'\n'}A better day.</Text>
              <Text style={styles.heroCaption}>Your people, your plans,{'\n'}your wellbeing. Together.</Text>
            </View>
            <View style={styles.heroNote}><MaterialCommunityIcons name="star-four-points" size={13} color="#FFB85C" /><Text style={styles.heroNoteText}>GOOD TO HAVE YOU HERE</Text></View>
          </View>
        </View>

        {/* ─── SOS Emergency Button at the TOP ─── */}
        <View style={[styles.section, { marginTop: 16, marginBottom: 8 }]}>
          <Animated.View style={{ transform: [{ scale: sosPulse }] }}>
            <TouchableOpacity 
              style={[styles.sosButton, sosSent && styles.sosButtonSent]} 
              onPress={handleSOS}
              disabled={sosSending || sosSent}
              activeOpacity={0.7}
            >
              <View style={styles.sosInner}>
                <View style={styles.sosIconWrap}>
                  <MaterialCommunityIcons name={sosSent ? 'check-circle' : 'alarm-light'} size={32} color="#FFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sosTitle}>{sosSent ? 'SOS Sent ✓' : sosSending ? 'Sending...' : 'Emergency SOS'}</Text>
                  <Text style={styles.sosSubtitle}>{sosSent ? 'Help is on the way' : 'Tap to alert administrators & caretaker'}</Text>
                </View>
                {!sosSent && !sosSending && (
                  <MaterialCommunityIcons name="chevron-right" size={24} color="rgba(255,255,255,0.7)" />
                )}
              </View>
            </TouchableOpacity>
          </Animated.View>
        </View>

        <View style={styles.dailyIntro}><View><Text style={styles.sectionEyebrow}>MADE FOR YOUR EVERYDAY</Text><Text style={styles.dailyTitle}>A day that feels good.</Text></View><View style={styles.flowerSticker}><Image source={require('../../assets/careconnect-companion.png')} style={styles.companionImage} resizeMode="contain" accessible={false} /></View></View>
        <View style={styles.section}><Text style={styles.sectionTitle}>Your Wellness Matters</Text><Text style={{fontSize:16,marginVertical:10}}>Room {resident?.room_number??'Not assigned'} · Floor {resident?.floor_number??'Not assigned'}</Text>
          <View style={{padding:16,borderRadius:18,backgroundColor:'white'}}><Text style={{fontSize:18,fontWeight:'700'}}>Today's Summary</Text><Text style={{marginTop:8}}>Medications taken: {takenCount}</Text><Text style={{marginTop:8,color:wellnessStyle(wellnessScore(resident?.emotionalStates?.[0])).color}}>Wellness: {wellnessStyle(wellnessScore(resident?.emotionalStates?.[0])).label}{wellnessScore(resident?.emotionalStates?.[0])!=null?' · '+wellnessScore(resident.emotionalStates[0])+'/100':''}</Text><Text style={{marginTop:8}}>Next appointment: {nextAppointment?calendarDateKey(nextAppointment.appointment_date):'None scheduled'}</Text></View>
          <WellnessTrend records={resident?.emotionalStates||[]}/>
        </View>

        {/* ─── Modules Grid ─── */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <MaterialCommunityIcons name="apps" size={20} color="#171459" />
            <Text style={styles.sectionTitle}>Quick Access</Text>
          </View>
          <View style={styles.modulesContainer}>
            <FeatureCard title="How I Feel" subtitle="Log your wellness" icon="emoticon-outline" color="#6D38FF" onPress={()=>navigation.navigate('LiveEmotion')}/>
            <FeatureCard title="Upload Rx" subtitle="Camera, image or manual entry" icon="file-document-outline" color="#6765D0" onPress={()=>navigation.navigate('UploadRx')}/>
            <FeatureCard title="My Profile" subtitle="Address and emergency contacts" icon="account-outline" color="#C45B74" onPress={()=>navigation.navigate('Profile')}/>
            <FeatureCard 
              title="Medications" 
              subtitle="View your daily pills" 
              icon="pill" 
              color="#6D38FF" 
              onPress={() => navigation.navigate('Medications')} 
            />
            <FeatureCard 
              title="Meal Suggestions" 
              subtitle="AI-curated dietary plan" 
              icon="silverware-fork-knife" 
              color="#D26D57" 
              onPress={() => navigation.navigate('MealPlan')} 
            />
            <FeatureCard 
              title="Appointments" 
              subtitle="Upcoming doctor visits" 
              icon="calendar-clock" 
              color="#6765D0" 
              onPress={() => navigation.navigate('Appointments')} 
            />
          </View>
        </View>

        {/* ─── Assigned Caretaker ─── */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <MaterialCommunityIcons name="shield-account" size={20} color="#5B32BD" />
            <Text style={styles.sectionTitle}>Your Caretaker</Text>
          </View>

          {loadingCaretakers ? (
            <View style={styles.caretakerLoading}>
              <ActivityIndicator size="small" color="#6D38FF" />
              <Text style={styles.loadingText}>Loading...</Text>
            </View>
          ) : caretakers.length > 0 ? (
            caretakers.map((ct) => (
              <TouchableOpacity 
                key={ct.caretaker_id} 
                style={styles.caretakerCard}
                activeOpacity={0.8}
                onPress={() => handleCallCaretaker(ct.phone, ct.name)}
              >
                {/* Gradient accent top */}
                <View style={styles.caretakerGradientTop}>
                  <View style={styles.caretakerCardInner}>
                    {/* Avatar + Info */}
                    <View style={styles.caretakerRow}>
                      <View style={styles.caretakerAvatar}>
                        <Text style={styles.caretakerAvatarText}>{ct.name.charAt(0).toUpperCase()}</Text>
                        <View style={[styles.onlineDot, { backgroundColor: ct.is_active ? '#10B981' : '#898AA3' }]} />
                      </View>
                      <View style={styles.caretakerInfo}>
                        <Text style={styles.caretakerName}>{ct.name}</Text>
                        {ct.specialization && (
                          <View style={styles.specChip}>
                            <MaterialCommunityIcons name="stethoscope" size={12} color="#6D38FF" />
                            <Text style={styles.specText}>{ct.specialization}</Text>
                          </View>
                        )}
                      </View>
                    </View>

                    {/* Quick Action Buttons */}
                    <View style={styles.caretakerActions}>
                      {ct.phone && (
                        <TouchableOpacity 
                          style={styles.actionCircle}
                          onPress={(e) => { e.stopPropagation(); handleCallCaretaker(ct.phone, ct.name); }}
                          activeOpacity={0.7}
                        >
                          <MaterialCommunityIcons name="phone" size={20} color="#FFFFFF" />
                        </TouchableOpacity>
                      )}
                      {ct.email && (
                        <TouchableOpacity 
                          style={[styles.actionCircle, styles.emailCircle]}
                          onPress={(e) => { e.stopPropagation(); handleEmailCaretaker(ct.email, ct.name); }}
                          activeOpacity={0.7}
                        >
                          <MaterialCommunityIcons name="email-outline" size={20} color="#FFFFFF" />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>

                  {/* Contact details row */}
                  <View style={styles.contactRow}>
                    {ct.phone && (
                      <View style={styles.contactItem}>
                        <MaterialCommunityIcons name="phone-outline" size={14} color="#73708F" />
                        <Text style={styles.contactText}>{ct.phone}</Text>
                      </View>
                    )}
                    {ct.email && (
                      <View style={styles.contactItem}>
                        <MaterialCommunityIcons name="email-outline" size={14} color="#73708F" />
                        <Text style={styles.contactText} numberOfLines={1}>{ct.email}</Text>
                      </View>
                    )}
                  </View>

                  {/* Tap to call hint */}
                  <View style={styles.tapHint}>
                    <MaterialCommunityIcons name="gesture-tap" size={14} color="#A7F3D0" />
                    <Text style={styles.tapHintText}>Tap to call</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))
          ) : (
            <View style={styles.noCaretakerCard}>
              <MaterialCommunityIcons name="account-alert-outline" size={36} color="#CBD5E1" />
              <Text style={styles.noCaretakerText}>No caretaker assigned yet</Text>
              <Text style={styles.noCaretakerSub}>Contact admin to assign a caretaker</Text>
            </View>
          )}
        </View>

        {/* ─── AI Wellness Check ─── */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <MaterialCommunityIcons name="heart-pulse" size={20} color="#6D38FF" />
            <Text style={styles.sectionTitle}>Wellness</Text>
          </View>
          <TouchableOpacity 
            style={styles.aiCard}
            onPress={() => navigation.navigate('LiveEmotion')}
            activeOpacity={0.85}
          >
            <View style={styles.aiCardContent}>
              <View style={styles.aiIconWrap}>
                <MaterialCommunityIcons name="face-recognition" size={28} color="#6D38FF" />
              </View>
              <View style={styles.aiTextWrap}>
                <Text style={styles.aiTitle}>Live Face Detection</Text>
                <Text style={styles.aiSubtitle}>Live expressions • English / தமிழ் / සිංහල</Text>
              </View>
            </View>
            <View style={styles.aiArrow}>
              <MaterialCommunityIcons name="arrow-right" size={20} color="#6D38FF" />
            </View>
          </TouchableOpacity>
        </View>

        {/* ─── Today's Appointments (RED) ─── */}
        {todayAppointments.length > 0 && (
          <View style={styles.section}>
            <View style={{ backgroundColor: '#FEF2F2', borderRadius: 16, padding: 16, borderWidth: 1.5, borderColor: '#FECACA' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 }}>
                <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: '#EF4444', justifyContent: 'center', alignItems: 'center' }}>
                  <MaterialCommunityIcons name="calendar-alert" size={18} color="#FFF" />
                </View>
                <Text style={{ fontSize: 15, fontWeight: '800', color: '#DC2626' }}>Today's Appointments</Text>
              </View>
              {todayAppointments.map((apt) => (
                <TouchableOpacity 
                  key={apt.appointment_id}
                  style={{ backgroundColor: '#FFF', borderRadius: 12, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: '#FCA5A5', flexDirection: 'row', alignItems: 'center', gap: 10 }}
                  onPress={() => navigation.navigate('Appointments')}
                  activeOpacity={0.8}
                >
                  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: '#FEE2E2', justifyContent: 'center', alignItems: 'center' }}>
                    <MaterialCommunityIcons name="stethoscope" size={20} color="#DC2626" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#991B1B' }}>Dr. {apt.doctor_name}</Text>
                    <Text style={{ fontSize: 11, color: '#B91C1C' }}>{apt.appointment_time || 'Time not set'} • {apt.specialization || 'General'}</Text>
                  </View>
                  <View style={{ backgroundColor: '#EF4444', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                    <Text style={{ fontSize: 10, fontWeight: '800', color: '#FFF' }}>TODAY</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* ─── Notifications ─── */}
        {notifications.length > 0 && (
          <View style={styles.section}>
            <View style={{ backgroundColor: "#EEE9FF", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#EEE4FF" }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 }}>
                <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: "#6D38FF", justifyContent: 'center', alignItems: 'center' }}>
                  <MaterialCommunityIcons name="bell-ring" size={18} color="#FFF" />
                </View>
                <Text style={{ fontSize: 15, fontWeight: '800', color: '#1E40AF' }}>New Notifications</Text>
                <View style={{ backgroundColor: "#6D38FF", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, marginLeft: 4 }}>
                  <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '800' }}>{notifications.length}</Text>
                </View>
              </View>
              {notifications.slice(0, 3).map((notif) => (
                <View key={notif.notification_id} style={{ backgroundColor: '#FFF', borderRadius: 12, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: '#E5E3FF', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: notif.type === 'appointment' ? '#E5E3FF' : "#F6F5FF", justifyContent: 'center', alignItems: 'center' }}>
                    <MaterialCommunityIcons name={notif.type === 'appointment' ? 'calendar-check' : 'bell-outline'} size={18} color={notif.type === 'appointment' ? "#6D38FF" : "#73708F"} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: "#171459" }} numberOfLines={1}>{notif.title}</Text>
                    <Text style={{ fontSize: 11, color: "#73708F", marginTop: 1 }} numberOfLines={2}>{notif.message}</Text>
                  </View>
                  <TouchableOpacity onPress={() => dismissNotification(notif.notification_id)} style={{ padding: 4 }}>
                    <MaterialCommunityIcons name="close-circle" size={20} color="#898AA3" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ─── Upload Rx ─── */}
        <TouchableOpacity style={styles.uploadCard} onPress={() => navigation.navigate('UploadRx')} activeOpacity={0.9}>
          <View style={styles.uploadInner}>
            <View style={styles.uploadIconWrap}>
              <MaterialCommunityIcons name="file-document-outline" size={32} color="#FFFFFF" />
            </View>
            <View style={styles.uploadTextContainer}>
              <Text style={styles.uploadTitle}>Upload Prescription</Text>
              <Text style={styles.uploadSubtitle}>Scan & digitize your Rx instantly</Text>
            </View>
          </View>
          <View style={styles.uploadAction}>
            <MaterialCommunityIcons name="camera-plus" size={24} color="#6D38FF" />
          </View>
        </TouchableOpacity>

        {/* ─── Quick Summary Chips ─── */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll} contentContainerStyle={styles.chipsContainer}>
          <View style={[styles.chip, { backgroundColor: "#EEE9FF" }]}>
            <MaterialCommunityIcons name="pill" size={18} color="#6D38FF" />
            <Text style={[styles.chipText, { color: "#5B32BD" }]}>3 Meds left</Text>
          </View>
          <View style={[styles.chip, { backgroundColor: '#FFFBEB' }]}>
            <MaterialCommunityIcons name="calendar-check" size={18} color="#D97706" />
            <Text style={[styles.chipText, { color: '#92400E' }]}>1 Appointment</Text>
          </View>
          <View style={[styles.chip, { backgroundColor: '#F0FDF4' }]}>
            <MaterialCommunityIcons name="emoticon-happy-outline" size={18} color="#16A34A" />
            <Text style={[styles.chipText, { color: '#166534' }]}>Mood logged</Text>
          </View>
        </ScrollView>

        <View style={styles.careEditorial}>
          <Image source={require('../../assets/careconnect-care.jpg')} style={styles.carePhoto} resizeMode="cover" accessibilityIgnoresInvertColors />
          <View style={styles.careEditorialCopy}><Text style={styles.sectionEyebrow}>THE HUMAN SIDE OF CARE</Text><Text style={styles.careEditorialTitle}>Together feels better.</Text><Text style={styles.careEditorialText}>Connection belongs in your everyday.</Text></View>
          <View style={styles.photoSticker}><MaterialCommunityIcons name="heart-outline" size={24} color="#171459" /></View>
        </View>


      </Animated.ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F6F5FF"
  },
  scrollContainer: {
    paddingBottom: 40,
    maxWidth: 600,
    width: "100%",
    alignSelf: "center"
  },
  // ─── Header ───
  headerWrapper: {
    backgroundColor: "#6D38FF",
    paddingBottom: 0,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    shadowColor: "#6D38FF",
    shadowOffset: {
      "width": 0,
      "height": 8
    },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 3,
    marginBottom: 20,
    margin: 16,
    borderRadius: 32,
    overflow: "hidden"
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 21
  },
  greeting: {
    fontSize: 12,
    color: "#EEE4FF",
    fontWeight: '600',
    marginBottom: 3
  },
  userName: {
    fontSize: 25,
    fontWeight: '900',
    color: "#FFFFFF",
    letterSpacing: -0.8,
    lineHeight: 32
  },
  logoutBtn: {
    minHeight: 44,
    minWidth: 44,
    padding: 10,
    backgroundColor: "#FFFFFF26",
    borderRadius: 15,
    shadowColor: '#E11D48',
    shadowOffset: {
      width: 0,
      height: 2
    },
    shadowOpacity: 0,
    shadowRadius: 10,
    elevation: 0
  },
  // ─── Sections ───
  section: {
    marginBottom: 24,
    paddingHorizontal: 20
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 13
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: "#171459",
    lineHeight: 24,
    letterSpacing: -0.45
  },
  // ─── Caretaker Card (Premium) ───
  caretakerCard: {
    borderRadius: 25,
    overflow: 'hidden',
    shadowColor: "#171459",
    shadowOffset: {
      "width": 0,
      "height": 8
    },
    shadowOpacity: 0.04,
    shadowRadius: 20,
    elevation: 1,
    borderWidth: 0,
    borderColor: "#E4DFFF"
  },
  caretakerGradientTop: {
    backgroundColor: '#FFFFFF',
    borderRadius: 25,
    borderWidth: 1,
    borderColor: "#E4DFFF",
    overflow: 'hidden'
  },
  caretakerCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 18,
    paddingBottom: 12,
    flexWrap: "wrap",
    gap: 12
  },
  caretakerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 180
  },
  caretakerAvatar: {
    width: 56,
    height: 56,
    borderRadius: 20,
    backgroundColor: "#EEE9FF",
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
    borderWidth: 2,
    borderColor: "#C6B6FF",
    position: 'relative'
  },
  caretakerAvatarText: {
    fontSize: 24,
    fontWeight: '900',
    color: "#6D38FF"
  },
  onlineDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    position: 'absolute',
    bottom: -2,
    right: -2,
    borderWidth: 2.5,
    borderColor: '#FFFFFF'
  },
  caretakerInfo: {
    flex: 1
  },
  caretakerName: {
    fontSize: 17,
    fontWeight: "800",
    color: "#171459",
    marginBottom: 4,
    lineHeight: 24
  },
  specChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: "#F6F5FF",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    alignSelf: 'flex-start'
  },
  specText: {
    fontSize: 12,
    color: "#6D38FF",
    fontWeight: '700'
  },
  caretakerActions: {
    flexDirection: 'row',
    gap: 8
  },
  actionCircle: {
    minHeight: 44,
    minWidth: 44,
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "#3478FF",
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: "#6D38FF",
    shadowOffset: {
      width: 0,
      height: 3
    },
    shadowOpacity: 0,
    shadowRadius: 6,
    elevation: 0
  },
  emailCircle: {
    backgroundColor: "#6D38FF"
  },
  contactRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    paddingHorizontal: 18,
    paddingBottom: 10
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: "100%",
    flexShrink: 1
  },
  contactText: {
    fontSize: 13,
    color: "#73708F",
    fontWeight: '500',
    flexShrink: 1,
    lineHeight: 18
  },
  tapHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: "#EEE9FF",
    paddingVertical: 10
  },
  tapHintText: {
    color: "#5B32BD",
    fontSize: 12,
    fontWeight: "700"
  },
  caretakerLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    padding: 24,
    borderRadius: 20,
    gap: 10,
    borderWidth: 1,
    borderColor: "#E4DFFF"
  },
  loadingText: {
    color: "#73708F",
    fontSize: 14,
    fontWeight: '500'
  },
  noCaretakerCard: {
    alignItems: 'center',
    backgroundColor: "#EEE9FF",
    padding: 24,
    borderRadius: 25,
    borderWidth: 0,
    borderColor: "#E4DFFF",
    borderStyle: "solid"
  },
  noCaretakerText: {
    color: "#5B32BD",
    fontSize: 15,
    fontWeight: "700",
    marginTop: 10
  },
  noCaretakerSub: {
    color: "#73708F",
    fontSize: 12,
    fontWeight: '500',
    marginTop: 4
  },
  // ─── AI Card ───
  aiCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: "#EAEFFF",
    padding: 19,
    borderRadius: 25,
    borderWidth: 0,
    borderColor: "#E4DFFF",
    shadowColor: "#171459",
    shadowOffset: {
      width: 0,
      height: 4
    },
    shadowOpacity: 0,
    shadowRadius: 12,
    elevation: 0
  },
  aiCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1
  },
  aiIconWrap: {
    width: 50,
    height: 50,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14
  },
  aiTextWrap: {
    flex: 1
  },
  aiTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#171459",
    marginBottom: 3,
    lineHeight: 23
  },
  aiSubtitle: {
    fontSize: 11,
    color: "#615C87",
    fontWeight: '600',
    lineHeight: 19
  },
  aiArrow: {
    backgroundColor: "#FFFFFF",
    width: 36,
    height: 36,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center'
  },
  // ─── Upload Card ───
  uploadCard: {
    marginHorizontal: 20,
    marginBottom: 20,
    backgroundColor: "#3478FF",
    borderRadius: 27,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: "#3478FF",
    shadowOffset: {
      "width": 0,
      "height": 8
    },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 3
  },
  uploadInner: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1
  },
  uploadIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14
  },
  uploadTextContainer: {
    flex: 1,
    minWidth: 0
  },
  uploadTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 2,
    lineHeight: 22
  },
  uploadSubtitle: {
    fontSize: 11,
    color: "#FFFFFF",
    fontWeight: '500',
    lineHeight: 18
  },
  uploadAction: {
    backgroundColor: '#FFFFFF',
    padding: 10,
    borderRadius: 17,
    shadowColor: "#171459",
    shadowOffset: {
      width: 0,
      height: 2
    },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 0,
    marginLeft: 12
  },
  // ─── Chips ───
  chipsScroll: {
    marginBottom: 24
  },
  chipsContainer: {
    paddingHorizontal: 20,
    gap: 10
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderRadius: 18,
    gap: 7
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700'
  },
  // ─── Module Cards ───
  modulesContainer: {
    gap: 12,
    flexDirection: "row",
    flexWrap: "wrap"
  },
  card: {
    flexDirection: "column",
    alignItems: "flex-start",
    backgroundColor: "#FFFFFF",
    padding: 17,
    borderRadius: 25,
    borderLeftWidth: 0,
    shadowColor: "#171459",
    shadowOffset: {
      "width": 0,
      "height": 8
    },
    shadowOpacity: 0.04,
    shadowRadius: 20,
    elevation: 1,
    borderWidth: 1,
    borderColor: "#E6E0FF",
    width: "48%",
    flexGrow: 1,
    minHeight: 176
  },
  iconContainer: {
    width: 49,
    height: 49,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 0,
    marginBottom: 13,
    transform: [{
      "rotate": "-6deg"
    }]
  },
  cardContent: {
    flex: 1,
    width: "100%"
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#171459",
    marginBottom: 4,
    lineHeight: 20,
    letterSpacing: -0.35
  },
  cardSubtitle: {
    fontSize: 11,
    color: "#73708F",
    fontWeight: '500',
    lineHeight: 16,
    paddingRight: 6
  },
  chevronCircle: {
    minHeight: 28,
    minWidth: 28,
    width: 28,
    height: 28,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    position: "absolute",
    top: 20,
    right: 13
  },
  // ─── SOS Button ───
  sosButton: {
    backgroundColor: "#C74956",
    borderRadius: 25,
    padding: 18,
    shadowColor: '#DC2626',
    shadowOffset: {
      width: 0,
      height: 8
    },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 1,
    borderWidth: 1,
    borderColor: "#F8C4C5"
  },
  sosButtonSent: {
    backgroundColor: '#16A34A',
    borderColor: '#86EFAC',
    shadowColor: '#16A34A'
  },
  sosInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14
  },
  sosIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  sosTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: '#FFF',
    letterSpacing: -0.1,
    lineHeight: 24
  },
  sosSubtitle: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.8)',
    fontWeight: '600',
    marginTop: 2,
    lineHeight: 17
  },
  brandEyebrow: {
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.7,
    color: "#FFFFFF",
    paddingHorizontal: 0,
    paddingTop: 0,
    flex: 1
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 20,
    paddingTop: 20
  },
  brandMark: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: "#FFFFFF26",
    alignItems: "center",
    justifyContent: "center"
  },
  patientPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: "#FFFFFF26"
  },
  patientPillText: {
    fontSize: 8,
    letterSpacing: 1.1,
    fontWeight: "800",
    color: "#FFFFFF"
  },
  heroContent: {
    minHeight: 240,
    position: "relative",
    overflow: "hidden",
    marginTop: 4
  },
  heroOrb: {
    position: "absolute",
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: "#945EFF",
    top: 2,
    right: -40
  },
  heroArtwork: {
    position: "absolute",
    width: 156,
    height: 156,
    top: 12,
    right: 6
  },
  heartSticker: {
    position: "absolute",
    top: 10,
    right: 110,
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFCE5C",
    transform: [{
      "rotate": "-13deg"
    }]
  },
  heroCopy: {
    paddingHorizontal: 20,
    paddingTop: 36,
    paddingBottom: 40,
    width: "60%"
  },
  heroHeadline: {
    fontSize: 25,
    lineHeight: 30,
    letterSpacing: -0.8,
    fontWeight: "800",
    color: "#FFFFFF"
  },
  heroCaption: {
    fontSize: 11,
    lineHeight: 17,
    marginTop: 10,
    color: "#F5EEFF",
    fontWeight: "500"
  },
  heroNote: {
    position: "absolute",
    bottom: 20,
    left: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  heroNoteText: {
    fontSize: 8,
    letterSpacing: 1.3,
    color: "#F5EEFF",
    fontWeight: "800"
  },
  dailyIntro: {
    paddingHorizontal: 22,
    marginBottom: 17,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  sectionEyebrow: {
    fontSize: 8,
    letterSpacing: 1.4,
    fontWeight: "800",
    color: "#6D38FF",
    marginBottom: 6
  },
  dailyTitle: {
    fontSize: 22,
    lineHeight: 29,
    letterSpacing: -0.6,
    fontWeight: "800",
    color: "#171459"
  },
  flowerSticker: {
    width: 47,
    height: 47,
    borderRadius: 16,
    backgroundColor: "#E8F0FF",
    alignItems: "center",
    justifyContent: "center",
    transform: []
  },
  careEditorial: {
    marginHorizontal: 20,
    marginBottom: 24,
    borderRadius: 28,
    overflow: "hidden",
    backgroundColor: "#EEE9FF",
    position: "relative"
  },
  carePhoto: {
    height: 162,
    width: "100%",
    backgroundColor: "#E4DFFF"
  },
  careEditorialCopy: {
    padding: 21
  },
  careEditorialTitle: {
    color: "#171459",
    fontSize: 23,
    lineHeight: 29,
    fontWeight: "800",
    letterSpacing: -0.7
  },
  careEditorialText: {
    color: "#73708F",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6
  },
  photoSticker: {
    position: "absolute",
    top: 141,
    right: 21,
    width: 44,
    height: 44,
    borderRadius: 15,
    backgroundColor: "#FFCE5C",
    alignItems: "center",
    justifyContent: "center",
    transform: [{
      "rotate": "12deg"
    }]
  },
  headerGlow: {
    position: "absolute",
    left: -115,
    top: -80,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: "#3478FF",
    opacity: 0.78
  },
  companionImage: {
    width: 56,
    height: 56,
    alignSelf: "center",
    marginTop: -5
  }
});

export default DashboardScreen;
