import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { auth } from '../firebase/config';

const API_BASE = 'https://api.careconnect.website/api';

const WellnessAlertScreen = ({ route, navigation }) => {
  const { alert } = route.params;
  const [acknowledged, setAcknowledged] = React.useState(alert.acknowledged);

  const getSeverityColor = (severity) => {
    if (severity === 'critical') return '#DC2626';
    if (severity === 'warning') return '#F59E0B';
    return '#3B82F6';
  };

  const getSeverityBg = (severity) => {
    if (severity === 'critical') return '#FEE2E2';
    if (severity === 'warning') return '#FEF3C7';
    return '#EFF6FF';
  };

  const getSeverityIcon = (severity) => {
    if (severity === 'critical') return 'alert-octagon';
    if (severity === 'warning') return 'alert-circle';
    return 'information';
  };

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  const handleAcknowledge = async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken();

      const res = await fetch(`${API_BASE}/emotions/wellness-alerts/${alert.id}/acknowledge`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ acknowledgedBy: user.displayName || 'Caretaker' })
      });

      if (res.ok) {
        setAcknowledged(true);
        Alert.alert('Acknowledged', 'Alert has been marked as reviewed.', [
          { text: 'OK', onPress: () => navigation.goBack() }
        ]);
      }
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Could not acknowledge alert.');
    }
  };

  const color = getSeverityColor(alert.severity);
  const bgColor = getSeverityBg(alert.severity);

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#134E4A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Wellness Alert</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContainer}>
        
        {/* Severity Banner */}
        <View style={[styles.severityBanner, { backgroundColor: bgColor, borderColor: color + '40' }]}>
          <MaterialCommunityIcons name={getSeverityIcon(alert.severity)} size={40} color={color} />
          <View style={styles.severityInfo}>
            <Text style={[styles.severityLabel, { color }]}>{alert.severity.toUpperCase()}</Text>
            <Text style={styles.severityTime}>{formatDate(alert.created_at)}</Text>
          </View>
        </View>

        {/* Patient Info */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <MaterialCommunityIcons name="account" size={20} color="#0D9488" />
            <Text style={styles.cardTitle}>Patient</Text>
          </View>
          <View style={styles.patientRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{(alert.resident_name || 'U').charAt(0)}</Text>
            </View>
            <View>
              <Text style={styles.patientName}>{alert.resident_name}</Text>
              <Text style={styles.patientId}>ID: {alert.resident_id}</Text>
            </View>
          </View>
        </View>

        {/* Wellness Score */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <MaterialCommunityIcons name="heart-pulse" size={20} color="#E11D48" />
            <Text style={styles.cardTitle}>Wellness Score</Text>
          </View>
          <View style={styles.scoreRow}>
            <View style={[styles.scoreCircle, { borderColor: color }]}>
              <Text style={[styles.scoreValue, { color }]}>{alert.state_score}</Text>
              <Text style={styles.scoreMax}>/100</Text>
            </View>
            <View style={styles.scoreDetails}>
              <Text style={styles.emotionLabel}>{alert.emotion_label || 'Unknown'}</Text>
              <Text style={styles.categoryLabel}>{alert.category || 'N/A'}</Text>
              <View style={styles.scoreBar}>
                <View style={[styles.scoreBarFill, { width: `${alert.state_score}%`, backgroundColor: color }]} />
              </View>
            </View>
          </View>
        </View>

        {/* Clinical Observation */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <MaterialCommunityIcons name="clipboard-text" size={20} color="#3B82F6" />
            <Text style={styles.cardTitle}>AI Clinical Observation</Text>
          </View>
          <Text style={styles.noteText}>{alert.note || 'No clinical note available.'}</Text>
        </View>

        {/* Actions */}
        {!acknowledged ? (
          <TouchableOpacity style={styles.ackButton} onPress={handleAcknowledge}>
            <MaterialCommunityIcons name="check-circle" size={24} color="#FFF" />
            <Text style={styles.ackButtonText}>Acknowledge Alert</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.ackedBanner}>
            <MaterialCommunityIcons name="check-decagram" size={24} color="#059669" />
            <Text style={styles.ackedText}>Alert acknowledged</Text>
          </View>
        )}

        <TouchableOpacity 
          style={styles.viewProfileBtn}
          onPress={() => navigation.navigate('PatientProfile', { 
            patient: { resident_id: alert.resident_id, name: alert.resident_name, room: 'N/A', age: 'N/A' }
          })}
        >
          <MaterialCommunityIcons name="account-details" size={20} color="#0D9488" />
          <Text style={styles.viewProfileText}>View Patient Profile</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F0FDFA' },
  header: { 
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', 
    paddingHorizontal: 20, paddingVertical: 16, backgroundColor: '#FFFFFF',
    borderBottomWidth: 1, borderBottomColor: '#CCFBF1'
  },
  backBtn: { padding: 8, backgroundColor: '#F0FDFA', borderRadius: 20 },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#134E4A' },

  scrollContainer: { padding: 20, paddingBottom: 40 },

  severityBanner: {
    flexDirection: 'row', alignItems: 'center', padding: 20, borderRadius: 20,
    borderWidth: 1, marginBottom: 20,
  },
  severityInfo: { marginLeft: 16 },
  severityLabel: { fontSize: 20, fontWeight: '900', letterSpacing: 1 },
  severityTime: { fontSize: 13, color: '#64748B', fontWeight: '500', marginTop: 4 },

  card: {
    backgroundColor: '#FFFFFF', borderRadius: 20, padding: 20, marginBottom: 16,
    shadowColor: '#134E4A', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05,
    shadowRadius: 8, elevation: 2, borderWidth: 1, borderColor: '#E2E8F0',
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#64748B', marginLeft: 8, textTransform: 'uppercase', letterSpacing: 0.5 },

  patientRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#F0FDFA', justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  avatarText: { fontSize: 20, fontWeight: '800', color: '#0D9488' },
  patientName: { fontSize: 18, fontWeight: '700', color: '#1E293B' },
  patientId: { fontSize: 13, color: '#94A3B8', fontWeight: '500', marginTop: 2 },

  scoreRow: { flexDirection: 'row', alignItems: 'center' },
  scoreCircle: {
    width: 80, height: 80, borderRadius: 40, borderWidth: 4, justifyContent: 'center', alignItems: 'center', marginRight: 20,
  },
  scoreValue: { fontSize: 28, fontWeight: '900' },
  scoreMax: { fontSize: 12, color: '#94A3B8', fontWeight: '600', marginTop: -4 },
  scoreDetails: { flex: 1 },
  emotionLabel: { fontSize: 18, fontWeight: '700', color: '#1E293B', marginBottom: 4 },
  categoryLabel: { fontSize: 13, color: '#64748B', fontWeight: '500', marginBottom: 8, textTransform: 'capitalize' },
  scoreBar: { height: 8, backgroundColor: '#F1F5F9', borderRadius: 4, overflow: 'hidden' },
  scoreBarFill: { height: '100%', borderRadius: 4 },

  noteText: { fontSize: 15, color: '#334155', lineHeight: 24 },

  ackButton: {
    backgroundColor: '#0D9488', flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    paddingVertical: 16, borderRadius: 16, gap: 10, marginBottom: 12,
    shadowColor: '#0D9488', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  ackButtonText: { color: '#FFF', fontSize: 17, fontWeight: '700' },

  ackedBanner: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8,
    backgroundColor: '#ECFDF5', paddingVertical: 16, borderRadius: 16, marginBottom: 12,
    borderWidth: 1, borderColor: '#A7F3D0',
  },
  ackedText: { color: '#059669', fontSize: 16, fontWeight: '700' },

  viewProfileBtn: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8,
    backgroundColor: '#CCFBF1', paddingVertical: 14, borderRadius: 16,
  },
  viewProfileText: { color: '#0D9488', fontSize: 15, fontWeight: '700' },
});

export default WellnessAlertScreen;
