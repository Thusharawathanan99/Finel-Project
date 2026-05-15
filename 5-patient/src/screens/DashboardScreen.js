import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Animated, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { auth } from '../firebase/config';
import { apiFetch, getResidentId } from '../apiHelper';

const DashboardScreen = ({ navigation }) => {
  const [patientName, setPatientName] = useState('Patient');
  const [caretakers, setCaretakers] = useState([]);
  const [loadingCaretakers, setLoadingCaretakers] = useState(true);
  const [notifications, setNotifications] = useState([]);
  const [todayAppointments, setTodayAppointments] = useState([]);
  const [sosSending, setSosSending] = useState(false);
  const [sosSent, setSosSent] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const sosPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Entrance animation
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start();

    // SOS button pulse animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(sosPulse, { toValue: 1.08, duration: 1000, useNativeDriver: true }),
        Animated.timing(sosPulse, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])
    ).start();

    const user = auth.currentUser;
    if (user && user.displayName) {
      setPatientName(user.displayName.split(' ')[0]);
    }

    const fetchCaretakers = async () => {
      try {
        const residentId = await getResidentId();
        const res = await apiFetch(`/residents/${residentId}/caretakers`);
        if (res.ok) {
          const data = await res.json();
          setCaretakers(data);
        }
      } catch (err) {
        console.warn('[Dashboard] Could not fetch caretakers:', err.message);
      } finally {
        setLoadingCaretakers(false);
      }
    };
    fetchCaretakers();

    // Fetch notifications & today's appointments
    const fetchNotifications = async () => {
      try {
        const residentId = await getResidentId();
        const res = await apiFetch(`/residents/${residentId}/notifications`);
        if (res.ok) {
          const data = await res.json();
          setNotifications(data.filter(n => !n.is_read));
        }
      } catch (err) {
        console.warn('[Dashboard] Notifications fetch error:', err.message);
      }
    };

    const fetchTodayAppointments = async () => {
      try {
        const residentId = await getResidentId();
        const res = await apiFetch(`/residents/${residentId}/appointments`);
        if (res.ok) {
          const data = await res.json();
          const today = new Date().toISOString().split('T')[0];
          setTodayAppointments(data.filter(a => a.appointment_date && a.appointment_date.substring(0, 10) === today && a.status !== 'cancelled'));
        }
      } catch (err) {
        console.warn('[Dashboard] Appointments fetch error:', err.message);
      }
    };

    fetchNotifications();
    fetchTodayAppointments();
  }, []);

  const handleLogout = async () => {
    try {
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
      await apiFetch(`/notifications/${notifId}/read`, { method: 'PUT' });
      setNotifications(prev => prev.filter(n => n.notification_id !== notifId));
    } catch (err) {
      console.warn('Failed to dismiss notification');
    }
  };

  const handleSOS = () => {
    Alert.alert(
      '🚨 Emergency SOS',
      'This will send an immediate emergency alert to all administrators and your caretaker. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'SEND SOS', style: 'destructive', onPress: triggerSOS },
      ]
    );
  };

  const triggerSOS = async () => {
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
        Alert.alert('✅ SOS Sent', 'Emergency alert has been sent. Help is on the way.');
        setTimeout(() => setSosSent(false), 30000); // Reset after 30s
      } else {
        Alert.alert('Error', 'Failed to send SOS. Please try again or call your caretaker directly.');
      }
    } catch (err) {
      console.error('[SOS] Error:', err);
      Alert.alert('Error', 'Network error. Please call your caretaker directly.');
    } finally {
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
          <View style={styles.header}>
            <View>
              <Text style={styles.greeting}>{getGreeting()} 👋</Text>
              <Text style={styles.userName}>{patientName}</Text>
            </View>
            <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn} activeOpacity={0.7}>
              <MaterialCommunityIcons name="logout-variant" size={22} color="#E11D48" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ─── Assigned Caretaker ─── */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <MaterialCommunityIcons name="shield-account" size={20} color="#0F766E" />
            <Text style={styles.sectionTitle}>Your Caretaker</Text>
          </View>

          {loadingCaretakers ? (
            <View style={styles.caretakerLoading}>
              <ActivityIndicator size="small" color="#0D9488" />
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
                        <View style={[styles.onlineDot, { backgroundColor: ct.is_active ? '#10B981' : '#94A3B8' }]} />
                      </View>
                      <View style={styles.caretakerInfo}>
                        <Text style={styles.caretakerName}>{ct.name}</Text>
                        {ct.specialization && (
                          <View style={styles.specChip}>
                            <MaterialCommunityIcons name="stethoscope" size={12} color="#0D9488" />
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
                        <MaterialCommunityIcons name="phone-outline" size={14} color="#64748B" />
                        <Text style={styles.contactText}>{ct.phone}</Text>
                      </View>
                    )}
                    {ct.email && (
                      <View style={styles.contactItem}>
                        <MaterialCommunityIcons name="email-outline" size={14} color="#64748B" />
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
            <MaterialCommunityIcons name="heart-pulse" size={20} color="#8B5CF6" />
            <Text style={styles.sectionTitle}>Wellness</Text>
          </View>
          <TouchableOpacity 
            style={styles.aiCard}
            onPress={() => navigation.navigate('LiveEmotion')}
            activeOpacity={0.85}
          >
            <View style={styles.aiCardContent}>
              <View style={styles.aiIconWrap}>
                <MaterialCommunityIcons name="face-recognition" size={28} color="#8B5CF6" />
              </View>
              <View style={styles.aiTextWrap}>
                <Text style={styles.aiTitle}>AI Live Wellness Check</Text>
                <Text style={styles.aiSubtitle}>Real-time camera analysis • Auto-alerts</Text>
              </View>
            </View>
            <View style={styles.aiArrow}>
              <MaterialCommunityIcons name="arrow-right" size={20} color="#8B5CF6" />
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
            <View style={{ backgroundColor: '#EFF6FF', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#BFDBFE' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 }}>
                <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: '#3B82F6', justifyContent: 'center', alignItems: 'center' }}>
                  <MaterialCommunityIcons name="bell-ring" size={18} color="#FFF" />
                </View>
                <Text style={{ fontSize: 15, fontWeight: '800', color: '#1E40AF' }}>New Notifications</Text>
                <View style={{ backgroundColor: '#3B82F6', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, marginLeft: 4 }}>
                  <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '800' }}>{notifications.length}</Text>
                </View>
              </View>
              {notifications.slice(0, 3).map((notif) => (
                <View key={notif.notification_id} style={{ backgroundColor: '#FFF', borderRadius: 12, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: '#DBEAFE', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: notif.type === 'appointment' ? '#DBEAFE' : '#F1F5F9', justifyContent: 'center', alignItems: 'center' }}>
                    <MaterialCommunityIcons name={notif.type === 'appointment' ? 'calendar-check' : 'bell-outline'} size={18} color={notif.type === 'appointment' ? '#2563EB' : '#64748B'} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#1E293B' }} numberOfLines={1}>{notif.title}</Text>
                    <Text style={{ fontSize: 11, color: '#64748B', marginTop: 1 }} numberOfLines={2}>{notif.message}</Text>
                  </View>
                  <TouchableOpacity onPress={() => dismissNotification(notif.notification_id)} style={{ padding: 4 }}>
                    <MaterialCommunityIcons name="close-circle" size={20} color="#94A3B8" />
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
            <MaterialCommunityIcons name="camera-plus" size={24} color="#0EA5E9" />
          </View>
        </TouchableOpacity>

        {/* ─── Quick Summary Chips ─── */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll} contentContainerStyle={styles.chipsContainer}>
          <View style={[styles.chip, { backgroundColor: '#EFF6FF' }]}>
            <MaterialCommunityIcons name="pill" size={18} color="#3B82F6" />
            <Text style={[styles.chipText, { color: '#1D4ED8' }]}>3 Meds left</Text>
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

        {/* ─── Modules Grid ─── */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <MaterialCommunityIcons name="apps" size={20} color="#1E293B" />
            <Text style={styles.sectionTitle}>Quick Access</Text>
          </View>
          <View style={styles.modulesContainer}>
            <FeatureCard 
              title="Medications" 
              subtitle="View your daily pills" 
              icon="pill" 
              color="#10B981" 
              onPress={() => navigation.navigate('Medications')} 
            />
            <FeatureCard 
              title="Meal Suggestions" 
              subtitle="AI-curated dietary plan" 
              icon="silverware-fork-knife" 
              color="#F97316" 
              onPress={() => navigation.navigate('MealPlan')} 
            />
            <FeatureCard 
              title="Appointments" 
              subtitle="Upcoming doctor visits" 
              icon="calendar-clock" 
              color="#F59E0B" 
              onPress={() => navigation.navigate('Appointments')} 
            />
            <FeatureCard 
              title="Complaints" 
              subtitle="Report issues to admin" 
              icon="message-alert-outline" 
              color="#EF4444" 
              onPress={() => navigation.navigate('Complaints')} 
            />
          </View>
        </View>

        {/* ─── SOS Emergency Button ─── */}
        <View style={styles.section}>
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

      </Animated.ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F1F5F9' },
  scrollContainer: { paddingBottom: 40 },
  
  // ─── Header ───
  headerWrapper: { 
    backgroundColor: '#FFFFFF', paddingBottom: 20, 
    borderBottomLeftRadius: 28, borderBottomRightRadius: 28,
    shadowColor: '#64748B', shadowOffset: { width: 0, height: 6 }, 
    shadowOpacity: 0.06, shadowRadius: 12, elevation: 4,
    marginBottom: 24,
  },
  header: { 
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', 
    paddingHorizontal: 24, paddingTop: 16,
  },
  greeting: { fontSize: 15, color: '#64748B', fontWeight: '600', marginBottom: 2 },
  userName: { fontSize: 30, fontWeight: '900', color: '#0F172A', letterSpacing: -0.8 },
  logoutBtn: { 
    padding: 10, backgroundColor: '#FFF1F2', borderRadius: 14,
    shadowColor: '#E11D48', shadowOffset: { width: 0, height: 2 }, 
    shadowOpacity: 0.1, shadowRadius: 4, elevation: 2,
  },

  // ─── Sections ───
  section: { marginBottom: 24, paddingHorizontal: 20 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: '#1E293B' },

  // ─── Caretaker Card (Premium) ───
  caretakerCard: {
    borderRadius: 24, overflow: 'hidden',
    shadowColor: '#0D9488', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12, shadowRadius: 16, elevation: 6,
  },
  caretakerGradientTop: {
    backgroundColor: '#FFFFFF', borderRadius: 24, 
    borderWidth: 1.5, borderColor: '#CCFBF1', overflow: 'hidden',
  },
  caretakerCardInner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 18, paddingBottom: 12,
  },
  caretakerRow: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  caretakerAvatar: {
    width: 56, height: 56, borderRadius: 20, backgroundColor: '#F0FDFA',
    justifyContent: 'center', alignItems: 'center', marginRight: 14,
    borderWidth: 2, borderColor: '#99F6E4', position: 'relative',
  },
  caretakerAvatarText: { fontSize: 24, fontWeight: '900', color: '#0D9488' },
  onlineDot: {
    width: 14, height: 14, borderRadius: 7, position: 'absolute', bottom: -2, right: -2,
    borderWidth: 2.5, borderColor: '#FFFFFF',
  },
  caretakerInfo: { flex: 1 },
  caretakerName: { fontSize: 18, fontWeight: '800', color: '#134E4A', marginBottom: 4 },
  specChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#F0FDFA', paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 8, alignSelf: 'flex-start',
  },
  specText: { fontSize: 12, color: '#0D9488', fontWeight: '700' },
  
  caretakerActions: { flexDirection: 'row', gap: 10 },
  actionCircle: {
    width: 42, height: 42, borderRadius: 14, backgroundColor: '#0D9488',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#0D9488', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3, shadowRadius: 6, elevation: 4,
  },
  emailCircle: { backgroundColor: '#3B82F6' },

  contactRow: { 
    flexDirection: 'row', flexWrap: 'wrap', gap: 16, 
    paddingHorizontal: 18, paddingBottom: 10,
  },
  contactItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  contactText: { fontSize: 12, color: '#64748B', fontWeight: '500' },

  tapHint: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    backgroundColor: '#0D9488', paddingVertical: 8,
  },
  tapHintText: { color: '#ECFDF5', fontSize: 12, fontWeight: '700' },

  caretakerLoading: { 
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFFFFF', padding: 24, borderRadius: 20, gap: 10,
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  loadingText: { color: '#64748B', fontSize: 14, fontWeight: '500' },
  noCaretakerCard: {
    alignItems: 'center', backgroundColor: '#FFFFFF', padding: 28, borderRadius: 20,
    borderWidth: 1.5, borderColor: '#E2E8F0', borderStyle: 'dashed',
  },
  noCaretakerText: { color: '#64748B', fontSize: 15, fontWeight: '600', marginTop: 10 },
  noCaretakerSub: { color: '#94A3B8', fontSize: 12, fontWeight: '500', marginTop: 4 },

  // ─── AI Card ───
  aiCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', padding: 16,
    borderRadius: 20, borderWidth: 1, borderColor: '#EDE9FE',
    shadowColor: '#8B5CF6', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08, shadowRadius: 12, elevation: 3,
  },
  aiCardContent: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  aiIconWrap: {
    width: 50, height: 50, borderRadius: 16, backgroundColor: '#F5F3FF',
    justifyContent: 'center', alignItems: 'center', marginRight: 14,
  },
  aiTextWrap: { flex: 1 },
  aiTitle: { fontSize: 16, fontWeight: '700', color: '#1E293B', marginBottom: 3 },
  aiSubtitle: { fontSize: 12, color: '#8B5CF6', fontWeight: '600' },
  aiArrow: { 
    backgroundColor: '#F5F3FF', width: 36, height: 36, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
  },

  // ─── Upload Card ───
  uploadCard: { 
    marginHorizontal: 20, marginBottom: 20,
    backgroundColor: '#0EA5E9', borderRadius: 24, padding: 20, flexDirection: 'row', 
    alignItems: 'center', justifyContent: 'space-between',
    shadowColor: '#0284C7', shadowOffset: { width: 0, height: 10 }, 
    shadowOpacity: 0.3, shadowRadius: 16, elevation: 8,
  },
  uploadInner: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  uploadIconWrap: {
    width: 48, height: 48, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center', marginRight: 14,
  },
  uploadTextContainer: {},
  uploadTitle: { fontSize: 20, fontWeight: '800', color: '#FFFFFF', marginBottom: 2 },
  uploadSubtitle: { fontSize: 13, color: '#BAE6FD', fontWeight: '500' },
  uploadAction: { 
    backgroundColor: '#FFFFFF', padding: 12, borderRadius: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1, shadowRadius: 4, elevation: 3,
  },

  // ─── Chips ───
  chipsScroll: { marginBottom: 24 },
  chipsContainer: { paddingHorizontal: 20, gap: 10 },
  chip: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 16,
    borderRadius: 14, gap: 7,
  },
  chipText: { fontSize: 13, fontWeight: '700' },

  // ─── Module Cards ───
  modulesContainer: { gap: 12 },
  card: { 
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', padding: 16, 
    borderRadius: 20, borderLeftWidth: 4,
    shadowColor: '#64748B', shadowOffset: { width: 0, height: 3 }, 
    shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  iconContainer: { 
    width: 52, height: 52, borderRadius: 16, justifyContent: 'center', 
    alignItems: 'center', marginRight: 14,
  },
  cardContent: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#1E293B', marginBottom: 3 },
  cardSubtitle: { fontSize: 13, color: '#64748B', fontWeight: '500' },
  chevronCircle: { width: 32, height: 32, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },

  // ─── SOS Button ───
  sosButton: {
    backgroundColor: '#DC2626', borderRadius: 20, padding: 18,
    shadowColor: '#DC2626', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4, shadowRadius: 16, elevation: 10,
    borderWidth: 2, borderColor: '#FCA5A5',
  },
  sosButtonSent: {
    backgroundColor: '#16A34A', borderColor: '#86EFAC',
    shadowColor: '#16A34A',
  },
  sosInner: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
  },
  sosIconWrap: {
    width: 52, height: 52, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
  },
  sosTitle: { fontSize: 20, fontWeight: '900', color: '#FFF', letterSpacing: 0.5 },
  sosSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.8)', fontWeight: '600', marginTop: 2 },
});

export default DashboardScreen;
