import { apiFetch } from '../apiHelper';
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { auth } from '../firebase/config';


const WellnessAlertScreen = ({ route, navigation }) => {
  const { alert } = route.params;
  const [acknowledged, setAcknowledged] = React.useState(alert.acknowledged);

  const getSeverityColor = (severity) => {
    if (severity === 'critical') return '#DC2626';
    if (severity === 'warning') return '#F59E0B';
    return '#0B786C';
  };

  const getSeverityBg = (severity) => {
    if (severity === 'critical') return '#FEE2E2';
    if (severity === 'warning') return '#FEF3C7';
    return '#EAF5F1';
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

      const res = await apiFetch(`/emotions/wellness-alerts/${alert.id}/acknowledge`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ acknowledgedBy: user.displayName || 'Caretaker' })
      });

      if (!res.ok) throw new Error('Could not acknowledge');
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
          <MaterialCommunityIcons name="arrow-left" size={24} color="#171459" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Wellness Alert</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContainer}>
        
        <View style={styles.attentionHero}><View style={{ flex: 1 }}><Text style={styles.attentionEyebrow}>STAY CLOSE. STAY INFORMED.</Text><Text style={styles.attentionTitle}>A moment{'\n'}for their wellbeing.</Text></View><View style={styles.attentionIcon}><MaterialCommunityIcons name="heart-pulse" size={34} color="#FF887D" /></View></View>
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
            <MaterialCommunityIcons name="account" size={20} color="#6D38FF" />
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
        <View style={[styles.card, styles.scoreCard]}>
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
            <MaterialCommunityIcons name="clipboard-text" size={20} color="#6D38FF" />
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
          <MaterialCommunityIcons name="account-details" size={20} color="#6D38FF" />
          <Text style={styles.viewProfileText}>View Patient Profile</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1, backgroundColor: '#F6F5FF',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingVertical: 18, backgroundColor: '#F6F5FF',
  },
  backBtn: {
    width: 46, height: 46, borderRadius: 17, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E6E1FB',
  },
  headerTitle: {
    fontSize: 20, fontWeight: '800', color: '#171459', lineHeight: 28, letterSpacing: -0.6,
  },
  scrollContainer: {
    padding: 22, paddingBottom: 40,
  },
  severityBanner: {
    flexDirection: 'row', alignItems: 'center', padding: 21, borderRadius: 25, borderWidth: 1, marginBottom: 18,
  },
  severityInfo: {
    marginLeft: 16
  },
  severityLabel: {
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 1
  },
  severityTime: {
    fontSize: 13,
    color: '#73758E',
    fontWeight: '500',
    marginTop: 4
  },
  card: {
    backgroundColor: '#FFFFFF', borderRadius: 27, padding: 22, marginBottom: 18, borderWidth: 1, borderColor: '#E6E1FB',
    shadowColor: '#171459', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.07, shadowRadius: 18, elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14
  },
  cardTitle: {
    fontSize: 10, fontWeight: '800', color: '#73758E', marginLeft: 8, textTransform: 'uppercase', letterSpacing: 1,
  },
  patientRow: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  avatar: {
    width: 54, height: 62, borderRadius: 19, backgroundColor: '#EEEBFF', justifyContent: 'center', alignItems: 'center', marginRight: 16,
  },
  avatarText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#6D38FF'
  },
  patientName: {
    fontSize: 21, fontWeight: '800', color: '#171459', letterSpacing: -0.4,
  },
  patientId: {
    fontSize: 13,
    color: '#9496AA',
    fontWeight: '500',
    marginTop: 2
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  scoreCircle: {
    width: 95, height: 95, borderRadius: 32, borderWidth: 4, justifyContent: 'center', alignItems: 'center', marginRight: 20, backgroundColor: '#FFFFFF',
  },
  scoreValue: {
    fontSize: 34, fontWeight: '800', letterSpacing: -1,
  },
  scoreMax: {
    fontSize: 12,
    color: '#9496AA',
    fontWeight: '600',
    marginTop: -4
  },
  scoreDetails: {
    flex: 1
  },
  emotionLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: '#171459',
    marginBottom: 4
  },
  categoryLabel: {
    fontSize: 13,
    color: '#73758E',
    fontWeight: '500',
    marginBottom: 8,
    textTransform: 'capitalize'
  },
  scoreBar: {
    height: 9, backgroundColor: '#D8CCFF', borderRadius: 6, overflow: 'hidden', marginTop: 6,
  },
  scoreBarFill: {
    height: '100%',
    borderRadius: 4
  },
  noteText: {
    fontSize: 14, color: '#73758E', lineHeight: 24,
  },
  ackButton: { backgroundColor: '#6D38FF', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 18, borderRadius: 21, gap: 10, marginBottom: 12, minHeight: 56, shadowColor: '#6D38FF', shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.2, shadowRadius: 15, elevation: 3 },
  ackButtonText: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '700'
  },
  ackedBanner: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ECFDF5',
    paddingVertical: 16,
    borderRadius: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#A7F3D0'
  },
  ackedText: {
    color: '#059669',
    fontSize: 16,
    fontWeight: '700'
  },
  viewProfileBtn: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, backgroundColor: '#EEEBFF', paddingVertical: 17, borderRadius: 21,
  },
  viewProfileText: {
    color: '#6D38FF',
    fontSize: 15,
    fontWeight: '700'
  },
  attentionHero: { backgroundColor: '#6D38FF', borderRadius: 28, padding: 23, flexDirection: 'row', alignItems: 'center', gap: 15, marginBottom: 20 },
  attentionEyebrow: { color: '#D8CCFF', fontSize: 7, fontWeight: '800', letterSpacing: 0.9, marginBottom: 12 },
  attentionTitle: { fontSize: 25, color: '#FFFFFF', fontWeight: '800', letterSpacing: -0.7, lineHeight: 30 },
  attentionIcon: { width: 67, height: 79, borderRadius: 24, backgroundColor: '#3478FF', justifyContent: 'center', alignItems: 'center', transform: [{ rotate: '-5deg' }] },
  scoreCard: { backgroundColor: '#EEEBFF', borderColor: '#EEEBFF' }
});

export default WellnessAlertScreen;
