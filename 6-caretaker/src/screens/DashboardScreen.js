import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase/config';

const POLL_INTERVAL_MS = 15000; // Poll for alerts every 15 seconds
const API_BASE = 'https://api.careconnect.website/api';

const DashboardScreen = ({ navigation }) => {
  const [caretakerName, setCaretakerName] = React.useState('Caretaker');
  const [patients, setPatients] = React.useState([]);
  const [alerts, setAlerts] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [sosSending, setSosSending] = React.useState(false);
  const [sosSent, setSosSent] = React.useState(false);
  const pollRef = React.useRef(null);
  const sosPulse = React.useRef(new Animated.Value(1)).current;

  const fetchHeaders = async () => {
    const user = auth.currentUser;
    if (!user) return null;
    const token = await user.getIdToken();
    return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  };

  // Fetch dashboard data (caretaker info + assigned patients)
  React.useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;
        
        const headers = await fetchHeaders();

        // 1. Fetch Caretaker Info (includes assigned_residents array)
        const ctRes = await fetch(`${API_BASE}/caretakers/${user.uid}`, { headers });
        if (!ctRes.ok) throw new Error('Failed to fetch caretaker info');
        const ctData = await ctRes.json();
        setCaretakerName(ctData.name.split(' ')[0] || 'Caretaker');

        // 2. Fetch all residents and filter by assigned
        const resRes = await fetch(`${API_BASE}/residents`, { headers });
        if (!resRes.ok) throw new Error('Failed to fetch residents');
        const allResidents = await resRes.json();

        const assignedIds = ctData.assigned_residents || [];
        const assignedResidents = allResidents.filter(r => assignedIds.includes(r.resident_id)).map(r => ({
          id: r.resident_id,
          name: r.name,
          room: r.room_number || 'TBD',
          age: r.age || 'N/A',
          status: 'stable',
          raw: r
        }));

        setPatients(assignedResidents);
      } catch (err) {
        console.error('Error fetching dashboard data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
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
    Alert.alert(
      '🚨 Emergency SOS',
      'This will send an immediate emergency alert to all administrators. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'SEND SOS', style: 'destructive', onPress: triggerSOS },
      ]
    );
  };

  const triggerSOS = async () => {
    setSosSending(true);
    try {
      const headers = await fetchHeaders();
      // Send SOS for first assigned patient, or as a general caretaker alert
      const firstPatient = patients[0];
      const res = await fetch(`${API_BASE}/sos-alerts`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          residentId: firstPatient?.id || 'CARETAKER',
          residentName: firstPatient ? `${firstPatient.name} (via ${caretakerName})` : `Caretaker: ${caretakerName}`,
          message: `Emergency SOS broadcast by caretaker ${caretakerName}`
        })
      });
      if (res.ok) {
        setSosSent(true);
        Alert.alert('✅ SOS Sent', 'Emergency alert has been sent to all administrators. Help is on the way.');
        setTimeout(() => setSosSent(false), 30000); // Reset after 30s cooldown
      } else {
        Alert.alert('Error', 'Failed to send SOS. Please try again or call emergency services directly.');
      }
    } catch (err) {
      console.error('[SOS] Error:', err);
      Alert.alert('Error', 'Network error. Please call emergency services directly.');
    } finally {
      setSosSending(false);
    }
  };

  // Poll for wellness alerts
  const fetchAlerts = React.useCallback(async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;
      
      const headers = await fetchHeaders();
      const res = await fetch(`${API_BASE}/emotions/wellness-alerts/${user.uid}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setAlerts(data);
      }
    } catch (err) {
      console.error('Error fetching alerts:', err);
    }
  }, []);

  React.useEffect(() => {
    fetchAlerts(); // Initial fetch
    pollRef.current = setInterval(fetchAlerts, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchAlerts]);

  const handleAcknowledge = async (alertId) => {
    try {
      const headers = await fetchHeaders();
      const res = await fetch(`${API_BASE}/emotions/wellness-alerts/${alertId}/acknowledge`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ acknowledgedBy: caretakerName })
      });
      if (res.ok) {
        // Remove from local state
        setAlerts(prev => prev.filter(a => a.id !== alertId));
      }
    } catch (err) {
      console.error('Acknowledge error:', err);
    }
  };

  const handleLeave = () => {
    navigation.navigate('LeaveRequest');
  };

  const handleLogout = async () => {
    try {
      if (pollRef.current) clearInterval(pollRef.current);
      await signOut(auth);
      navigation.replace('Login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const unacknowledgedAlerts = alerts.filter(a => !a.acknowledged);
  const criticalCount = unacknowledgedAlerts.filter(a => a.severity === 'critical').length;
  const warningCount = unacknowledgedAlerts.filter(a => a.severity === 'warning').length;

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
    if (patientAlerts.some(a => a.severity === 'critical')) return 'critical';
    if (patientAlerts.some(a => a.severity === 'warning')) return 'warning';
    return 'stable';
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greeting}>Welcome back,</Text>
          <Text style={styles.name}>{caretakerName}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity style={styles.leaveBtn} onPress={handleLeave}>
            <MaterialCommunityIcons name="calendar-clock" size={20} color="#B45309" />
            <Text style={styles.leaveText}>Request Leave</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <MaterialCommunityIcons name="logout" size={24} color="#64748B" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        
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
              <Text style={styles.emptyAlertText}>All patients are doing well</Text>
              <Text style={styles.emptyAlertSub}>Live monitoring active • Polling every 15s</Text>
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
              <MaterialCommunityIcons name="account-group-outline" size={20} color="#0F766E" />
              <Text style={styles.sectionTitle}>Assigned Patients</Text>
            </View>
            <TouchableOpacity style={styles.viewAllBtn} onPress={() => navigation.navigate('PatientList')}>
              <Text style={styles.viewAllText}>View All</Text>
              <MaterialCommunityIcons name="arrow-right" size={16} color="#0D9488" />
            </TouchableOpacity>
          </View>

          <View style={styles.patientGrid}>
            {patients.map(p => {
              const status = getPatientStatus(p.id);
              return (
                <TouchableOpacity 
                  key={p.id} 
                  style={styles.patientCard}
                  onPress={() => navigation.navigate('PatientProfile', { patient: p.raw || p })}
                >
                  <View style={[
                    styles.statusIndicator, 
                    { backgroundColor: status === 'critical' ? '#E11D48' : status === 'warning' ? '#F59E0B' : '#10B981' }
                  ]} />
                  <View style={styles.patientAvatar}>
                    <Text style={styles.avatarText}>{p.name.charAt(0)}</Text>
                  </View>
                  <Text style={styles.patientName}>{p.name}</Text>
                  <Text style={styles.patientRoom}>Room {p.room}</Text>
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
                    {sosSent ? 'Help is on the way' : 'Tap to alert all administrators'}
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
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F0FDFA' },
  
  header: { 
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16, backgroundColor: '#FFFFFF',
    borderBottomWidth: 1, borderBottomColor: '#CCFBF1'
  },
  greeting: { fontSize: 13, color: '#0F766E', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  name: { fontSize: 22, fontWeight: '800', color: '#134E4A' },
  leaveBtn: { 
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF3C7', 
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, marginRight: 12
  },
  leaveText: { color: '#B45309', fontWeight: '700', marginLeft: 4, fontSize: 13 },
  logoutBtn: { padding: 8, backgroundColor: '#F1F5F9', borderRadius: 12 },

  scrollContainer: { padding: 20, paddingBottom: 40 },

  section: { marginBottom: 32 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  sectionHeaderBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: '#134E4A', marginLeft: 8 },
  badge: { backgroundColor: '#E11D48', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, marginLeft: 8 },
  badgeText: { color: '#FFF', fontSize: 12, fontWeight: 'bold' },

  emptyAlerts: { 
    alignItems: 'center', paddingVertical: 24, backgroundColor: '#ECFDF5', 
    borderRadius: 16, borderWidth: 1, borderColor: '#A7F3D0' 
  },
  emptyAlertText: { color: '#065F46', fontSize: 16, fontWeight: '700', marginTop: 8 },
  emptyAlertSub: { color: '#059669', fontSize: 12, fontWeight: '500', marginTop: 4 },

  alertCard: { 
    flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 16, marginBottom: 12,
    borderWidth: 1, elevation: 2, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4
  },
  alertCritical: { backgroundColor: '#FFE4E6', borderColor: '#FECDD3', shadowColor: '#E11D48' },
  alertWarning: { backgroundColor: '#FEF3C7', borderColor: '#FDE68A', shadowColor: '#D97706' },
  alertInfo: { flex: 1, marginLeft: 12 },
  alertPatientName: { fontSize: 16, fontWeight: '800', marginBottom: 2 },
  alertText: { fontSize: 14, fontWeight: '600', marginBottom: 2 },
  alertNote: { fontSize: 12, color: '#64748B', fontWeight: '500', marginBottom: 4 },
  alertTime: { fontSize: 11, color: '#94A3B8', fontWeight: '600' },

  ackBtn: { 
    backgroundColor: '#10B981', width: 32, height: 32, borderRadius: 16, 
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#10B981', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 3,
  },

  viewAllBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#CCFBF1', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  viewAllText: { color: '#0D9488', fontWeight: '700', fontSize: 13, marginRight: 4 },

  patientGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  patientCard: { 
    width: '31%', backgroundColor: '#FFFFFF', padding: 16, borderRadius: 16, alignItems: 'center', marginBottom: 12,
    shadowColor: '#134E4A', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2
  },
  statusIndicator: { width: 10, height: 10, borderRadius: 5, position: 'absolute', top: 10, right: 10 },
  patientAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#F0FDFA', justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  avatarText: { fontSize: 20, fontWeight: '800', color: '#0D9488' },
  patientName: { fontSize: 14, fontWeight: '700', color: '#1E293B', marginBottom: 2 },
  patientRoom: { fontSize: 11, color: '#64748B', fontWeight: '600' },

  sosContainer: { marginTop: 10 },
  sosButton: {
    backgroundColor: '#E11D48', borderRadius: 24, padding: 20, 
    shadowColor: '#E11D48', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 8,
    borderWidth: 4, borderColor: '#FFE4E6', overflow: 'hidden',
  },
  sosButtonSent: {
    backgroundColor: '#059669', borderColor: '#A7F3D0',
    shadowColor: '#059669',
  },
  sosInner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16,
  },
  sosIconWrap: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
  },
  sosText: { color: '#FFFFFF', fontSize: 20, fontWeight: '900', letterSpacing: 1 },
  sosSubtext: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '600', marginTop: 2 },
  sosPulseRing: {
    position: 'absolute', top: -2, right: -2, width: 16, height: 16,
    borderRadius: 8, backgroundColor: '#FDE047', borderWidth: 2, borderColor: '#FFF',
  }
});

export default DashboardScreen;
