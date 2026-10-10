import RequestError from '../components/RequestError';
import {useScreenRefresh} from '../useScreenRefresh';
import { apiFetch } from '../apiHelper';
import { wellnessStyle } from '../careSummary';
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const PatientListScreen = ({ navigation }) => {
  const [patients, setPatients] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [loadError, setLoadError] = React.useState(null);
  
  const fetchPatients = React.useCallback(async () => {
      setLoadError(null);
      try {
        const { auth } = require('../firebase/config');
        const user = auth.currentUser;
        if (!user) return;
        
        const token = await user.getIdToken();
        const headers = { 'Authorization': `Bearer ${token}` };

        // 1. Fetch Caretaker Info
        const ctRes = await apiFetch(`/caretakers/${user.uid}`, { headers });
        if (!ctRes.ok) throw new Error('Failed to fetch caretaker info');
        const ctData = await ctRes.json();

        // 2. Fetch all residents and filter by assigned
        const resRes = await apiFetch('/residents', { headers });
        if (!resRes.ok) throw new Error('Failed to fetch residents');
        const allResidents = await resRes.json();

        const rawAssigned = ctData.assigned_residents;
        const assignedIds = typeof rawAssigned === 'string'
          ? (() => { try { return JSON.parse(rawAssigned) || []; } catch { return []; } })()
          : (rawAssigned || []);
        const assignedResidents = allResidents.filter(r => Array.isArray(assignedIds) && assignedIds.includes(r.resident_id)).map(r => ({
          id: r.resident_id,
          name: r.name,
          room: r.room_number || 'TBD',
          age: r.age || 'N/A',
          status: 'unknown',
          condition: r.medical_history || 'N/A',
          raw: r // store raw data to pass to profile
        }));

        setPatients(assignedResidents);
      } catch (err) {
        setLoadError('Your patient list could not be loaded. Check your connection and try again.');
        console.error('Error fetching patient list:', err);
      } finally {
        setLoading(false);
      }
  }, []);
  useScreenRefresh(navigation, fetchPatients);

  const filteredPatients = patients.filter(p => 
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    p.room.toString().includes(searchQuery)
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#171459" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>All Patients</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.directoryHero}>
        <View style={{ flex: 1 }}><Text style={styles.directoryEyebrow}>YOUR CARE CIRCLE</Text><Text style={styles.directoryTitle}>People first. Always.</Text><Text style={styles.directorySub}>A closer look at everyone in your care.</Text></View>
        <View style={styles.directoryCount}><Text style={styles.directoryCountValue}>{patients.length}</Text><Text style={styles.directoryCountLabel}>assigned</Text></View>
      </View>
      <View style={styles.searchContainer}>
        <MaterialCommunityIcons name="magnify" size={20} color="#9496AA" style={{ marginRight: 8 }} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or room..."
          placeholderTextColor="#9496AA"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        <RequestError message={loadError} onRetry={fetchPatients} />
        {filteredPatients.map(p => (
          <TouchableOpacity 
            key={p.id} 
            style={styles.patientCard}
            onPress={() => navigation.navigate('PatientProfile', { patient: p.raw || p })}
          >
            <View style={[styles.statusIndicator, 
              p.status === 'critical' ? { backgroundColor: '#E11D48' } : 
              p.status === 'warning' ? { backgroundColor: '#F59E0B' } : 
              { backgroundColor: '#9496AA' }
            ]} />
            
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{p.name.charAt(0)}</Text>
            </View>

            <View style={styles.infoContainer}>
              <Text style={styles.name}>{p.name}</Text>
              <Text style={styles.details}>Room {p.room} • {p.age} yrs</Text>
              <Text style={{fontSize:12,color:wellnessStyle(p.raw?.latest_wellness_score==null?null:Number(p.raw.latest_wellness_score)).color}}>Wellness: {p.raw?.latest_wellness_score??'Not recorded'} · {p.raw?.medication_count??0} medications · {p.raw?.prescription_count??0} prescriptions</Text>
              <Text style={styles.condition}>{p.condition}</Text>
            </View>

            <MaterialCommunityIcons name="chevron-right" size={24} color="#9496AA" />
          </TouchableOpacity>
        ))}
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
  searchContainer: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', marginHorizontal: 22, marginTop: 18, marginBottom: 0, paddingHorizontal: 17, borderRadius: 19, borderWidth: 1, borderColor: '#E6E1FB', height: 56,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#171459'
  },
  scrollContainer: {
    padding: 22, paddingBottom: 40,
  },
  patientCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', padding: 18, borderRadius: 25, marginBottom: 14, minHeight: 110, borderWidth: 1, borderColor: '#E6E1FB',
    shadowColor: '#171459', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.07, shadowRadius: 18, elevation: 3,
  },
  statusIndicator: {
    width: 12, height: 12, borderRadius: 6, position: 'absolute', top: 19, left: 63, zIndex: 1, borderWidth: 2, borderColor: '#FFFFFF',
  },
  avatar: {
    width: 56, height: 64, borderRadius: 20, backgroundColor: '#EEEBFF', justifyContent: 'center', alignItems: 'center', marginRight: 15,
  },
  avatarText: {
    fontSize: 25, fontWeight: '800', color: '#6D38FF',
  },
  infoContainer: {
    flex: 1
  },
  name: {
    fontSize: 17, fontWeight: '800', color: '#171459', marginBottom: 6, lineHeight: 24,
  },
  details: {
    fontSize: 11, color: '#73758E', fontWeight: '600',
  },
  directoryHero: { marginHorizontal: 22, backgroundColor: '#6D38FF', borderRadius: 27, padding: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  directoryEyebrow: { fontSize: 8, fontWeight: '800', letterSpacing: 1.2, color: '#D8CCFF', marginBottom: 9 },
  directoryTitle: { color: '#FFFFFF', fontSize: 21, fontWeight: '800', letterSpacing: -0.5 },
  directorySub: { color: '#D8CCFF', fontSize: 10, lineHeight: 17, marginTop: 7 },
  directoryCount: { width: 60, height: 70, borderRadius: 21, backgroundColor: '#3478FF', alignItems: 'center', justifyContent: 'center' },
  directoryCountValue: { fontSize: 26, color: '#FFFFFF', fontWeight: '800' },
  directoryCountLabel: { fontSize: 8, color: '#EEEBFF', marginTop: 2 },
  condition: { fontSize: 11, color: '#9496AA', marginTop: 7, lineHeight: 16 }
});

export default PatientListScreen;
