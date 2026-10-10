import RequestError from '../components/RequestError';
import {useScreenRefresh} from '../useScreenRefresh';
import { apiFetch } from '../apiHelper';
import CareArtwork from '../components/CareArtwork';
import React from 'react';
import { AppState, Image, View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Animated, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase/config';
import { unregisterPushNotifications } from '../pushNotifications';
import { upcomingAppointments } from '../calendar';
import { wellnessStyle } from '../careSummary';

const POLL_INTERVAL_MS = 2000; // Foreground checks only; this is not background push delivery.

const DashboardScreen = ({ navigation }) => {
  const [caretakerName, setCaretakerName] = React.useState('Caretaker');
  const [patients, setPatients] = React.useState([]);
  const [alerts, setAlerts] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [sosSending, setSosSending] = React.useState(false);
  const [sosSent, setSosSent] = React.useState(false);
  const [sosAlerts, setSosAlerts] = React.useState([]);
  const [loadError, setLoadError] = React.useState(null);
  const [alertsError, setAlertsError] = React.useState(null);
  const [showSosPicker, setShowSosPicker] = React.useState(false);
  const [lastAlertRefresh, setLastAlertRefresh] = React.useState(null);
  const [resolvingSos, setResolvingSos] = React.useState(null);
  const [appointmentCount,setAppointmentCount] = React.useState(null);
  const sosLock = React.useRef(false);
  const pollRef = React.useRef(null);
  const feedRequest = React.useRef(null);
  const feedBusy = React.useRef(false);
  const feedEpoch = React.useRef(0);
  const mounted = React.useRef(true);
  const foreground = React.useRef(typeof AppState === 'undefined' || !AppState.currentState || AppState.currentState === 'active');
  const resolutionBusy = React.useRef(false);
  const resolutionRequest = React.useRef(null);
  const sosPulse = React.useRef(new Animated.Value(1)).current;

  const fetchHeaders = async () => {
    const user = auth.currentUser;
    if (!user) return null;
    const token = await user.getIdToken();
    return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  };

  // Fetch dashboard data (caretaker info + assigned patients)
  const fetchDashboardData = React.useCallback(async () => {
      setLoadError(null);
      try {
        const user = auth.currentUser;
        if (!user) return;
        
        const headers = await fetchHeaders();

        // 1. Fetch Caretaker Info (includes assigned_residents array)
        const ctRes = await apiFetch(`/caretakers/${user.uid}`, { headers });
        if (!ctRes.ok) throw new Error('Failed to fetch caretaker info');
        const ctData = await ctRes.json();
        setCaretakerName(ctData.name.split(' ')[0] || 'Caretaker');

        // 2. Fetch all residents and filter by assigned
        const resRes = await apiFetch(`/residents`, { headers });
        if (!resRes.ok) throw new Error('Failed to fetch residents');
        const allResidents = await resRes.json();

        let assignedIds = ctData.assigned_residents || [];
        if(typeof assignedIds==='string'){try{assignedIds=JSON.parse(assignedIds);}catch{assignedIds=[];}}
        if(!Array.isArray(assignedIds))assignedIds=[];
        const assignedResidents = allResidents.filter(r => assignedIds.includes(r.resident_id)).map(r => ({
          id: r.resident_id,
          name: r.name,
          room: r.room_number || 'TBD',
          age: r.age || 'N/A',
          status: 'unknown',
          raw: r
        }));

        setPatients(assignedResidents);
        const appointmentResponse=await apiFetch('/appointments');
        if(!appointmentResponse.ok)throw Error('Appointments unavailable');
        const upcoming=upcomingAppointments(await appointmentResponse.json()).filter(appointment=>assignedIds.includes(appointment.resident_id));
        setAppointmentCount(upcoming.length);
      } catch (err) {
        setLoadError('Your care assignments could not be loaded. Check your connection and try again.');
        console.error('Error fetching dashboard data:', err);
      } finally {
        setLoading(false);
      }
  }, []);

  // SOS button pulse animation
  React.useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(sosPulse, { toValue: 1.06, duration: 1000, useNativeDriver: true }),
        Animated.timing(sosPulse, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [sosPulse]);

  const handleSOS = () => {
    if (!patients.length) { Alert.alert('Choose a Resident', 'No assigned resident is available. Contact your administrator or emergency services directly.'); return; }
    setShowSosPicker(true);
  };
  const confirmSOS = patient => Alert.alert('Emergency for '+patient.name, 'This will alert the administrator with your name, resident location and the recorded time. Send the emergency alert?', [
    {text:'Cancel',style:'cancel'}, {text:'Send SOS',style:'destructive',onPress:()=>{setShowSosPicker(false);triggerSOS(patient);}}
  ]);
  const triggerSOS = async patient => {
    if (sosLock.current) return;
    if (!patient?.id || !patients.some(assigned => assigned.id === patient.id)) { Alert.alert('Choose a Resident', 'Select a resident assigned to your care.'); return; }
    sosLock.current=true; setSosSending(true);
    try {
      const res=await apiFetch('/sos-alerts',{method:'POST',body:JSON.stringify({residentId:patient.id,message:'Emergency SOS reported by caretaker '+caretakerName})});
      if (!res.ok) throw new Error('Emergency could not be recorded');
      setSosSent(true); await fetchAlerts();
      Alert.alert('SOS Recorded', 'The emergency is visible to the care team. Call emergency services if immediate help is needed.');
      setTimeout(()=>setSosSent(false),30000);
    } catch(error) { Alert.alert('SOS Failed','The alert could not be recorded. Call emergency services directly.'); }
    finally { sosLock.current=false; setSosSending(false); }
  };

  // Poll for wellness alerts
  const validSosFeed = rows => Array.isArray(rows) && rows.every(row => row && typeof row === 'object' && !Array.isArray(row) &&
    Number.isSafeInteger(row.id) && row.id > 0 && typeof row.resident_id === 'string' && row.resident_id.trim() && row.resident_id.length <= 50 &&
    typeof row.resident_name === 'string' && row.resident_name.trim() && row.resident_name.length <= 100 &&
    typeof row.message === 'string' && row.message.trim() && row.message.length <= 5000 &&
    (typeof row.created_at === 'string' || row.created_at instanceof Date) && Number.isFinite(new Date(row.created_at).getTime()));
  const fetchAlerts = React.useCallback(async () => {
    if (feedBusy.current || !mounted.current || !foreground.current || navigation?.isFocused?.() === false) return;
    const user=auth.currentUser;
    if (!user) { setAlerts([]); setSosAlerts([]); return; }
    const epoch=feedEpoch.current, controller=new AbortController();
    feedRequest.current=controller;feedBusy.current=true;
    let timedOut=false;
    const deadline=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(Error(timedOut?'Alert update timed out':'Alert update canceled')),{once:true}));
    const timeout=setTimeout(()=>{timedOut=true;controller.abort();},8000);
    const current=()=>mounted.current&&foreground.current&&feedEpoch.current===epoch&&auth.currentUser?.uid===user.uid;
    try {
      const responses=await Promise.allSettled(['/emotions/wellness-alerts/'+user.uid,'/sos-alerts'].map(async endpoint=>{
        const fetchFeed=async()=>{const response=await apiFetch(endpoint,{signal:controller.signal});if(!response.ok)throw new Error('Alert feed unavailable');const items=await response.json();if(!Array.isArray(items)||endpoint==='/sos-alerts'&&!validSosFeed(items))throw new Error('Invalid alert feed');return items;};
        return Promise.race([fetchFeed(),deadline]);
      }));
      if (!current()) return;
      if(responses[0].status==='fulfilled')setAlerts(responses[0].value);
      if(responses[1].status==='fulfilled')setSosAlerts(responses[1].value.filter(alert=>!alert.is_resolved));
      if(responses.some(result=>result.status==='fulfilled'))setLastAlertRefresh(Date.now());
      setAlertsError(responses.some(result=>result.status==='rejected') ? 'Some emergency or wellness updates could not be loaded. Retry the feed, or call your care team if help is urgent.' : null);
    } catch(error) { if(current())setAlertsError('Emergency and wellness updates could not be loaded. Call your care team if you need immediate assistance.'); }
    finally {clearTimeout(timeout);if(feedRequest.current===controller){feedRequest.current=null;feedBusy.current=false;}}
  }, [navigation]);
  const refreshDashboard=React.useCallback(()=>Promise.all([fetchDashboardData(),fetchAlerts()]),[fetchDashboardData,fetchAlerts]);
  useScreenRefresh(navigation,refreshDashboard);
  React.useEffect(()=>{
    mounted.current=true;
    const suspend=()=>{feedEpoch.current++;feedRequest.current?.abort();feedRequest.current=null;feedBusy.current=false;resolutionRequest.current?.abort();resolutionRequest.current=null;resolutionBusy.current=false;if(mounted.current)setResolvingSos(null);};
    const app=AppState.addEventListener('change',state=>{foreground.current=state==='active';if(!foreground.current)suspend();else void fetchAlerts();});
    const blur=navigation?.addListener?.('blur',suspend);
    const focus=navigation?.addListener?.('focus',()=>void fetchAlerts());
    pollRef.current=setInterval(()=>void fetchAlerts(),POLL_INTERVAL_MS);
    return ()=>{mounted.current=false;suspend();clearInterval(pollRef.current);app.remove();blur?.();focus?.();};
  },[fetchAlerts,navigation]);
  const resolveSOS=async id=>{
    if(resolutionBusy.current)return;
    const uid=auth.currentUser?.uid,epoch=feedEpoch.current;if(!uid)return;
    resolutionBusy.current=true;setResolvingSos(id);
    const controller=new AbortController();resolutionRequest.current=controller;
    let timedOut=false;
    const deadline=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(Error(timedOut?'Resolution could not be confirmed in time':'Resolution canceled')),{once:true}));
    const timeout=setTimeout(()=>{timedOut=true;controller.abort();},10000);
    try {
      const response=await Promise.race([apiFetch('/sos-alerts/'+id+'/resolve',{method:'PUT',signal:controller.signal}),deadline]);if(!response.ok)throw new Error('Could not resolve');
      if(mounted.current&&auth.currentUser?.uid===uid&&feedEpoch.current===epoch){
        feedEpoch.current++;feedRequest.current?.abort();feedRequest.current=null;feedBusy.current=false;
        setSosAlerts(previous=>previous.filter(alert=>alert.id!==id));await fetchAlerts();
      }
    }
    catch(error){if(mounted.current&&auth.currentUser?.uid===uid&&feedEpoch.current===epoch){setAlertsError('Resolution could not be confirmed. The alert remains visible; retry after contacting the resident.');Alert.alert('Could Not Resolve','Resolution could not be confirmed. Please retry after contacting the resident.');}}
    finally{clearTimeout(timeout);if(resolutionRequest.current===controller){resolutionRequest.current=null;resolutionBusy.current=false;if(mounted.current)setResolvingSos(null);}}
  };

  const handleAcknowledge = async (alertId) => {
    try {
      const headers = await fetchHeaders();
      const res = await apiFetch(`/emotions/wellness-alerts/${alertId}/acknowledge`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ acknowledgedBy: caretakerName })
      });
      if (!res.ok) throw new Error('Could not acknowledge alert');
      if (res.ok) {
        // Remove from local state
        setAlerts(prev => prev.filter(a => a.id !== alertId));
      }
    } catch (err) {
      Alert.alert('Could Not Acknowledge', 'Please try again.');
    }
  };

  const handleLeave = () => {
    navigation.navigate('LeaveRequest');
  };

  const handleLogout = async () => {
    try {
      if (pollRef.current) clearInterval(pollRef.current);
      const leavingUser = auth.currentUser;
      await unregisterPushNotifications().catch(() => {});
      if (auth.currentUser?.uid !== leavingUser?.uid) return;
      await signOut(auth);
      navigation.replace('Login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const unacknowledgedAlerts = alerts.filter(a => !a.acknowledged);
  const criticalCount = unacknowledgedAlerts.filter(a => a.severity === 'critical').length;
  const warningCount = unacknowledgedAlerts.filter(a => a.severity === 'warning').length;
  const wellnessScores=patients.filter(patient=>patient.raw?.latest_wellness_score!=null).map(patient=>Number(patient.raw.latest_wellness_score)).filter(score=>Number.isFinite(score)&&score>=0&&score<=100);
  const averageWellness=wellnessScores.length?Math.round(wellnessScores.reduce((sum,score)=>sum+score,0)/wellnessScores.length):null;

  const getAlertTimeAgo = (dateStr) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins} min${mins > 1 ? 's' : ''} ago`;
    const hours = Math.floor(mins / 60);
    return `${hours} hr${hours > 1 ? 's' : ''} ago`;
  };

  // Derive patient status from alerts
  const getPatientStatus = (residentId) => {
    const patientAlerts = unacknowledgedAlerts.filter(a => a.resident_id === residentId);
    if (sosAlerts.some(alert => alert.resident_id === residentId)) return 'critical';
    if (patientAlerts.some(a => a.severity === 'critical')) return 'critical';
    if (patientAlerts.some(a => a.severity === 'warning')) return 'warning';
    return 'unknown';
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <View style={styles.brandLine}><MaterialCommunityIcons name="medical-bag" size={16} color="#6D38FF" /><Text style={styles.brandText}>CareConnect</Text></View><Text style={styles.greeting}>Welcome back,</Text>
          <Text style={styles.name}>{caretakerName}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity style={styles.leaveBtn} onPress={handleLeave}>
            <MaterialCommunityIcons name="calendar-clock" size={18} color="#171459" />
            <Text style={styles.leaveText}>Request Leave</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <MaterialCommunityIcons name="logout" size={24} color="#73758E" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        <RequestError message={loadError} onRetry={refreshDashboard} />
        <RequestError message={alertsError} onRetry={fetchAlerts} />
        <Text style={{fontSize:12,color:'#73758E',marginBottom:12}}>Alerts check every 2 seconds while this screen is active. {lastAlertRefresh ? 'Last updated: '+new Date(lastAlertRefresh).toLocaleTimeString() : 'Waiting for an alert update.'}</Text>
        {sosAlerts.length > 0 && <View style={styles.section}><Text style={styles.sectionTitle}>Emergency SOS alerts</Text>{sosAlerts.map(alert=><View key={alert.id} style={{backgroundColor:'#FEF2F2',padding:16,borderRadius:16,marginTop:10}}><Text style={{color:'#991B1B',fontWeight:'800'}}>{alert.resident_name}</Text><Text>{alert.message}</Text><Text>{new Date(alert.created_at).toLocaleString()}</Text><TouchableOpacity disabled={resolvingSos!==null} onPress={()=>Alert.alert('Resolve emergency','Confirm the resident has received help before resolving.',[{text:'Cancel'},{text:'Resolve',onPress:()=>resolveSOS(alert.id)}])}><Text style={{paddingTop:12,color:'#991B1B',fontWeight:'700'}}>{resolvingSos===alert.id?'Resolving…':'Mark resolved after checking resident'}</Text></TouchableOpacity></View>)}</View>}
        <View style={styles.workspaceCard}>
          <View style={styles.heroHalo} /><View style={styles.heroGlow} />
          <View style={styles.heroTopline}>
            <View style={styles.heroPill}><MaterialCommunityIcons name="heart-pulse" size={14} color="#171459" /><Text style={styles.heroPillText}>YOUR CARE, CONNECTED</Text></View>
            <MaterialCommunityIcons name="star-four-points" size={24} color="#FF887D" />
          </View>
          <View style={styles.workspaceCopy}>
            <Text style={styles.workspaceTitle}>Care together.{'\n'}Better care.</Text>
            <Text style={styles.workspaceText}>Stay close to the people who count on you.</Text>
          </View>
          <CareArtwork source={require('../../assets/careconnect-characters.png')} style={styles.heroImage} resizeMode="contain" />
          <Image source={require('../../assets/careconnect-companion.png')} style={styles.heroCompanion} resizeMode="contain" accessible={false} />
          <View style={styles.heroSticker}><MaterialCommunityIcons name="shield-check-outline" size={17} color="#171459" /><Text style={styles.heroStickerText}>Made for caring</Text></View>
        </View>
        <View style={styles.overviewRow}>
          <View style={styles.overviewCard}><View style={styles.overviewIcon}><MaterialCommunityIcons name="account-heart-outline" size={21} color="#6D38FF" /></View><Text style={styles.overviewValue}>{patients.length}</Text><Text style={styles.overviewLabel}>In your care</Text></View>
          <View style={[styles.overviewCard, styles.overviewAccent]}><View style={styles.overviewIcon}><MaterialCommunityIcons name="bell-outline" size={21} color="#171459" /></View><Text style={styles.overviewValue}>{unacknowledgedAlerts.length+sosAlerts.length}</Text><Text style={styles.overviewLabel}>Open alerts</Text></View>
          <View style={styles.overviewCard}><View style={styles.overviewIcon}><MaterialCommunityIcons name="heart-outline" size={21} color="#FF887D" /></View><Text style={styles.overviewValue}>{averageWellness??'—'}</Text><Text style={styles.overviewLabel}>Avg wellness</Text></View>
          <View style={styles.overviewCard}><View style={styles.overviewIcon}><MaterialCommunityIcons name="calendar-outline" size={21} color="#6D38FF" /></View><Text style={styles.overviewValue}>{appointmentCount??'—'}</Text><Text style={styles.overviewLabel}>Upcoming visits</Text></View>
        </View>
        <View style={{flexDirection:'row',flexWrap:'wrap',marginHorizontal:22,gap:10}}>{[['View Residents','PatientList'],['Request Leave','LeaveRequest'],['Check Alerts','Alerts']].map(([label,screen])=><TouchableOpacity key={screen} onPress={()=>navigation.navigate(screen)} style={{padding:12,borderRadius:12,backgroundColor:'#EEE9FF'}}><Text style={{color:'#6D38FF',fontWeight:'700'}}>{label}</Text></TouchableOpacity>)}</View>
        
        <View style={styles.careStory}>
          <Image source={require('../../assets/careconnect-care.jpg')} style={styles.storyPhoto} resizeMode="cover" />
          <View style={styles.storyScrim} />
          <View style={styles.storyPill}><MaterialCommunityIcons name="heart-outline" size={13} color="#171459" /><Text style={styles.storyPillText}>THE HUMAN SIDE OF CARE</Text></View>
          <View style={styles.storyCopy}><Text style={styles.storyTitle}>Care lives in the everyday.</Text><Text style={styles.storySub}>The check-ins. The conversations. The little things.</Text></View>
        </View>
                {/* Live Wellness Alerts Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialCommunityIcons name="bell-ring-outline" size={20} color="#E11D48" />
            <Text style={styles.sectionTitle}>Wellness Alerts</Text>
            {unacknowledgedAlerts.length > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unacknowledgedAlerts.length}</Text>
              </View>
            )}
          </View>

          {unacknowledgedAlerts.length === 0 ? (
            <View style={styles.emptyAlerts}>
              <MaterialCommunityIcons name="check-circle-outline" size={36} color="#10B981" />
              <Text style={styles.emptyAlertText}>{alertsError ? 'Alert feed unavailable' : 'No open wellness alerts'}</Text>
              <Text style={styles.emptyAlertSub}>{alertsError ? 'Please retry the alert feed above' : 'Checking recorded alerts every 15 seconds'}</Text>
            </View>
          ) : (
            unacknowledgedAlerts.map((alert) => (
              <TouchableOpacity 
                key={alert.id} 
                style={[
                  styles.alertCard, 
                  alert.severity === 'critical' ? styles.alertCritical : styles.alertWarning
                ]}
                onPress={() => navigation.navigate('WellnessAlert', { alert })}
              >
                <MaterialCommunityIcons 
                  name={alert.severity === 'critical' ? 'alert-decagram' : 'alert-circle'} 
                  size={28} 
                  color={alert.severity === 'critical' ? '#9F1239' : '#B45309'} 
                />
                <View style={styles.alertInfo}>
                  <Text style={[
                    styles.alertPatientName, 
                    { color: alert.severity === 'critical' ? '#881337' : '#78350F' }
                  ]}>
                    {alert.resident_name}
                  </Text>
                  <Text style={[
                    styles.alertText, 
                    { color: alert.severity === 'critical' ? '#9F1239' : '#92400E' }
                  ]}>
                    {alert.emotion_label} — Score: {alert.state_score}/100
                  </Text>
                  <Text style={styles.alertNote} numberOfLines={1}>{alert.note}</Text>
                  <Text style={styles.alertTime}>{getAlertTimeAgo(alert.created_at)}</Text>
                </View>
                <TouchableOpacity 
                  style={styles.ackBtn} 
                  onPress={(e) => { e.stopPropagation(); handleAcknowledge(alert.id); }}
                >
                  <MaterialCommunityIcons name="check" size={18} color="#FFF" />
                </TouchableOpacity>
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* Assigned Patients Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderBetween}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <MaterialCommunityIcons name="account-group-outline" size={20} color="#171459" />
              <Text style={styles.sectionTitle}>Recent Residents</Text>
            </View>
            <TouchableOpacity style={styles.viewAllBtn} onPress={() => navigation.navigate('PatientList')}>
              <Text style={styles.viewAllText}>View All</Text>
              <MaterialCommunityIcons name="arrow-right" size={16} color="#6D38FF" />
            </TouchableOpacity>
          </View>

          <View style={styles.patientGrid}>
            {patients.slice(0,3).map(p => {
              const status = getPatientStatus(p.id);
              return (
                <TouchableOpacity 
                  key={p.id} 
                  style={styles.patientCard}
                  onPress={() => navigation.navigate('PatientProfile', { patient: p.raw || p })}
                >
                  <View style={[
                    styles.statusIndicator, 
                    { backgroundColor: status === 'critical' ? '#E11D48' : status === 'warning' ? '#F59E0B' : '#9496AA' }
                  ]} />
                  <View style={styles.patientAvatar}>
                    <Text style={styles.avatarText}>{p.name.charAt(0)}</Text>
                  </View>
                  <Text style={styles.patientName}>{p.name}</Text>
                  <Text style={styles.patientRoom}>Room {p.room}</Text>
                  <Text style={{paddingTop:6,color:wellnessStyle(p.raw?.latest_wellness_score==null?null:Number(p.raw.latest_wellness_score)).color}}>Wellness {p.raw?.latest_wellness_score??'—'}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Emergency SOS Button */}
        <View style={styles.sosContainer}>
          <Animated.View style={{ transform: [{ scale: sosPulse }] }}>
            <TouchableOpacity 
              style={[styles.sosButton, sosSent && styles.sosButtonSent]} 
              onPress={handleSOS}
              disabled={sosSending || sosSent}
              activeOpacity={0.7}
            >
              <View style={styles.sosInner}>
                <View style={styles.sosIconWrap}>
                  {sosSending ? (
                    <ActivityIndicator size={32} color="#FFFFFF" />
                  ) : (
                    <MaterialCommunityIcons name={sosSent ? "check-circle" : "phone-alert"} size={40} color="#FFFFFF" />
                  )}
                </View>
                <View>
                  <Text style={styles.sosText}>
                    {sosSent ? 'SOS Sent ✓' : sosSending ? 'Sending...' : 'EMERGENCY SOS'}
                  </Text>
                  <Text style={styles.sosSubtext}>
                    {sosSent ? 'Emergency recorded' : 'Choose the resident who needs help'}
                  </Text>
                </View>
              </View>
              {!sosSent && !sosSending && (
                <View style={styles.sosPulseRing} />
              )}
            </TouchableOpacity>
          </Animated.View>
        </View>

      </ScrollView>
      <Modal visible={showSosPicker} transparent animationType="slide" onRequestClose={()=>setShowSosPicker(false)}><View style={{flex:1,backgroundColor:'#0008',justifyContent:'center',padding:24}}><View style={{backgroundColor:'white',borderRadius:20,padding:20}}><Text style={{fontSize:20,fontWeight:'800'}}>Who needs emergency help?</Text><ScrollView style={{maxHeight:350}}>{patients.map(patient=><TouchableOpacity key={patient.id} onPress={()=>confirmSOS(patient)} style={{padding:16,borderBottomWidth:1,borderColor:'#eee'}}><Text style={{fontSize:17,fontWeight:'700'}}>{patient.name}</Text><Text>Room {patient.room}</Text></TouchableOpacity>)}</ScrollView><TouchableOpacity onPress={()=>setShowSosPicker(false)}><Text style={{padding:16}}>Cancel</Text></TouchableOpacity></View></View></Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F6F5FF'
  },
  header: {
    paddingHorizontal: 22, paddingTop: 18, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, backgroundColor: '#F6F5FF',
  },
  greeting: {
    fontSize: 12, fontWeight: '500', color: '#73758E', marginTop: 14,
  },
  name: {
    fontSize: 27, fontWeight: '800', lineHeight: 33, color: '#171459', letterSpacing: -0.8,
  },
  leaveBtn: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#EEEBFF', paddingHorizontal: 12, paddingVertical: 13, borderRadius: 18, marginRight: 8, minHeight: 44,
  },
  leaveText: {
    color: '#171459', fontWeight: '700', marginLeft: 5, fontSize: 11,
  },
  logoutBtn: {
    width: 42, height: 44, padding: 8, backgroundColor: '#FFFFFF', borderRadius: 17, alignItems: 'center', justifyContent: 'center',
  },
  scrollContainer: {
    padding: 22, paddingTop: 14, paddingBottom: 40, width: '100%', maxWidth: 920, alignSelf: 'center',
  },
  section: {
    marginBottom: 28,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16
  },
  sectionHeaderBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16
  },
  sectionTitle: {
    fontSize: 19, fontWeight: '800', color: '#171459', marginLeft: 8, lineHeight: 26, letterSpacing: -0.5,
  },
  badge: {
    backgroundColor: '#E11D48',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 8
  },
  badgeText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold'
  },
  emptyAlerts: {
    flexDirection: 'column', alignItems: 'center', padding: 24, backgroundColor: '#FFFFFF', borderRadius: 26, borderWidth: 1, borderColor: '#E6E1FB',
    shadowColor: '#171459', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.07, shadowRadius: 18, elevation: 3,
  },
  emptyAlertText: {
    color: '#171459', fontSize: 16, fontWeight: '700', marginTop: 10, lineHeight: 23,
  },
  emptyAlertSub: {
    color: '#73758E', fontSize: 11, marginTop: 5, lineHeight: 17,
  },
  alertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 20,
    marginBottom: 12,
    borderWidth: 1,
    elevation: 2,
    shadowOffset: {
      width: 0,
      height: 2
    },
    shadowOpacity: 0.05,
    shadowRadius: 12
  },
  alertCritical: {
    backgroundColor: '#FFE4E6',
    borderColor: '#FECDD3',
    shadowColor: '#E11D48'
  },
  alertWarning: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
    shadowColor: '#D97706'
  },
  alertInfo: {
    flex: 1,
    marginLeft: 12
  },
  alertPatientName: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 2,
    lineHeight: 23
  },
  alertText: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
    lineHeight: 21
  },
  alertNote: {
    fontSize: 13,
    color: '#73758E',
    fontWeight: '500',
    marginBottom: 4,
    lineHeight: 19
  },
  alertTime: {
    fontSize: 12,
    color: '#9496AA',
    fontWeight: '600'
  },
  ackBtn: {
    minHeight: 44,
    minWidth: 44,
    backgroundColor: '#10B981',
    width: 32,
    height: 32,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#10B981',
    shadowOffset: {
      width: 0,
      height: 2
    },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    elevation: 3
  },
  viewAllBtn: {
    minHeight: 38, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 11, borderRadius: 13, backgroundColor: '#EEEBFF',
  },
  viewAllText: {
    color: '#6D38FF',
    fontWeight: '700',
    fontSize: 13,
    marginRight: 4
  },
  patientGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between'
  },
  patientCard: {
    width: '48%', backgroundColor: '#FFFFFF', padding: 18, borderRadius: 26, alignItems: 'flex-start', marginBottom: 14, borderWidth: 1, borderColor: '#E6E1FB', minHeight: 172,
    shadowColor: '#171459', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.07, shadowRadius: 18, elevation: 3,
  },
  statusIndicator: {
    width: 11, height: 11, borderRadius: 6, position: 'absolute', top: 20, right: 18, borderWidth: 2, borderColor: '#FFFFFF',
  },
  patientAvatar: { width: 56, height: 56, borderRadius: 19, backgroundColor: '#EEEBFF', justifyContent: 'center', alignItems: 'center', marginBottom: 15, borderWidth: 1, borderColor: '#E2D8FF' },
  avatarText: {
    fontSize: 24, fontWeight: '800', color: '#6D38FF',
  },
  patientName: {
    fontSize: 16, fontWeight: '800', color: '#171459', lineHeight: 22, marginBottom: 4,
  },
  patientRoom: {
    fontSize: 12, color: '#73758E', fontWeight: '600', backgroundColor: '#F6F5FF', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
  },
  sosContainer: {
    marginTop: 10
  },
  sosButton: { backgroundColor: '#171459', borderRadius: 27, padding: 20, borderWidth: 1, borderColor: '#39327B', overflow: 'hidden', shadowColor: '#171459', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.1, shadowRadius: 18, elevation: 3 },
  sosButtonSent: {
    backgroundColor: '#059669',
    borderColor: '#A7F3D0',
    shadowColor: '#059669'
  },
  sosInner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 16,
  },
  sosIconWrap: { width: 54, height: 54, borderRadius: 18, backgroundColor: '#3478FF', justifyContent: 'center', alignItems: 'center' },
  sosText: {
    color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: 0.4, lineHeight: 24,
  },
  sosSubtext: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
    lineHeight: 19
  },
  sosPulseRing: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 12,
    backgroundColor: '#FDE047',
    borderWidth: 2,
    borderColor: '#FFF'
  },
  workspaceCard: { height: 326, backgroundColor: '#6D38FF', borderRadius: 32, padding: 24, marginBottom: 18, overflow: 'hidden', shadowColor: '#6D38FF', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.2, shadowRadius: 24, elevation: 4 },
  workspaceIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: "#7541E9",
    alignItems: "center",
    justifyContent: "center"
  },
  workspaceCopy: { width: '78%', zIndex: 2, marginTop: 18 },
  workspaceEyebrow: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.3,
    color: "#D8CCFF",
    marginBottom: 7
  },
  workspaceTitle: { fontSize: 24, lineHeight: 28, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.6 },
  workspaceText: { fontSize: 12, lineHeight: 17, color: '#E8E0FF', marginTop: 6, maxWidth: 170 },
  brandLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  brandText: { fontSize: 13, color: '#171459', fontWeight: '800', letterSpacing: -0.3 },
  heroHalo: { position: 'absolute', width: 220, height: 220, borderRadius: 110, backgroundColor: '#8151FF', right: -40, bottom: -40 },
  heroTopline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 3 },
  heroPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFFFFF', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20, alignSelf: 'flex-start' },
  heroPillText: { fontSize: 8, fontWeight: '800', color: '#171459', letterSpacing: 0.8 },
  heroImage: { width: 130, height: 145, position: 'absolute', bottom: 0, right: 6 },
  heroSticker: { position: 'absolute', right: 12, bottom: 10, backgroundColor: '#FFFFFF', borderRadius: 15, paddingHorizontal: 9, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 5, transform: [{ rotate: '-4deg' }], shadowColor: '#171459', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  heroStickerText: { fontSize: 10, color: '#171459', fontWeight: '800' },
  overviewRow: { flexDirection: 'row', gap: 10, marginBottom: 28 },
  overviewCard: { flex: 1, padding: 13, backgroundColor: '#FFFFFF', borderRadius: 22, borderWidth: 1, borderColor: '#E6E1FB' },
  overviewAccent: { backgroundColor: '#E6EEFF', borderColor: '#E6EEFF' },
  overviewIcon: { marginBottom: 10 },
  overviewValue: { fontSize: 26, fontWeight: '800', color: '#171459', letterSpacing: -1 },
  overviewLabel: { fontSize: 10, color: '#73758E', fontWeight: '600', marginTop: 3 },
  careStory: { height: 168, borderRadius: 27, overflow: 'hidden', marginBottom: 28, backgroundColor: '#171459' },
  storyPhoto: { width: '100%', height: '100%', position: 'absolute' },
  storyScrim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(37,40,91,0.30)' },
  storyPill: { position: 'absolute', top: 16, left: 17, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#FFFFFF', paddingHorizontal: 9, paddingVertical: 6, borderRadius: 15 },
  storyPillText: { color: '#171459', fontSize: 7, letterSpacing: 0.6, fontWeight: '800' },
  storyCopy: { position: 'absolute', left: 19, right: 19, bottom: 19 },
  storyTitle: { fontSize: 20, color: '#FFFFFF', fontWeight: '800', letterSpacing: -0.6, textShadowColor: 'rgba(37,40,91,0.4)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  storySub: { fontSize: 10, lineHeight: 17, color: '#FFFFFF', marginTop: 5 },
  heroGlow: { position: 'absolute', width: 220, height: 220, borderRadius: 110, backgroundColor: '#9872FF', right: -95, top: -55, opacity: 0.55 },
  heroCompanion: { position: 'absolute', left: 16, bottom: 10, width: 48, height: 54, opacity: 0.9 }
});

export default DashboardScreen;
