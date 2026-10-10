import RequestError from '../components/RequestError';
import DoseReminders from '../components/DoseReminders';
import NextDoseCountdown from '../components/NextDoseCountdown';
import { cancelLocalDoseReminder, remindMedicationCheckin } from '../pushNotifications';
import { colomboDay } from '../careSummary';
import { useScreenRefresh } from '../useScreenRefresh';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, RefreshControl, AppState } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { apiFetch, getResidentId } from '../apiHelper';

import { auth } from '../firebase/config';
import { millisecondsToNextDay } from '../dailyMedicationState';

const MedicationsScreen = ({ navigation }) => {
  const [medications, setMedications] = useState([]);
  const [takenIds, setTakenIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [residentId, setResidentId] = useState(null);
  const [scheduledMedicationIds, setScheduledMedicationIds] = useState(new Set());
  const schedulesLoaded = useCallback(rows => setScheduledMedicationIds(new Set(rows.filter(row => row.enabled).map(row => Number(row.medication_id)))), []);
  const [skippedIds,setSkippedIds]=useState(new Set());
  const [recording,setRecording]=useState(null);
  const recordLock=useRef(false);

  const mountedRef = useRef(true);

  const fetchMedications = useCallback(async () => {
    try {
      setLoadError(null);
      const residentId = await getResidentId();
      setResidentId(residentId);
      const res = await apiFetch(`/residents/${residentId}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();

      // Flatten all medications from all prescriptions
      const allMeds = [];
      for (const rx of (data.prescriptions || [])) {
        for (const med of (rx.medications || [])) {
          allMeds.push({
            id: med.id || `${rx.prescription_id}-${med.drug_name}`,
            prescriptionId: rx.prescription_id,
            drugName: med.drug_name,
            dosage: med.dosage || '',
            frequency: med.frequency || 'As directed',
            dateIssued: rx.date_issued,
            confirmed: med.confirmed,
          });
        }
      }
      setMedications(allMeds);

      const eventsResponse=await apiFetch(`/residents/${encodeURIComponent(residentId)}/medication-events?day=${colomboDay()}`),events=await eventsResponse.json();
      if(!eventsResponse.ok||!Array.isArray(events))throw Error('Medication check-ins could not be loaded.');
      setTakenIds(new Set(events.filter(row=>row.status==='taken').map(row=>Number(row.medication_id))));
      setSkippedIds(new Set(events.filter(row=>row.status==='skipped').map(row=>Number(row.medication_id))));
    } catch (err) {
      setLoadError('Your medications could not be loaded. Check your connection and try again.');
      console.error('[Medications] Fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useScreenRefresh(navigation, fetchMedications);
  useEffect(() => {
    mountedRef.current = true;
    // Server records refresh on focus; daily progress also refreshes at midnight.
    let midnightTimer;
    const refreshDailyState = () => fetchMedications();
    const scheduleMidnight = () => {
      clearTimeout(midnightTimer);
      midnightTimer = setTimeout(() => { refreshDailyState(); scheduleMidnight(); }, millisecondsToNextDay());
    };
    scheduleMidnight();
    const appStateSubscription = AppState.addEventListener('change', state => {
      if (state === 'active') { refreshDailyState(); scheduleMidnight(); }
    });

    return () => {
      mountedRef.current = false;
      clearTimeout(midnightTimer);
      appStateSubscription.remove();

    };
  }, [fetchMedications, navigation]);

  const toggleTaken = async (medId) => {
    await recordMedication(medId,'taken');
  };
  const recordMedication=async(medId,status)=>{
    if(recordLock.current||scheduledMedicationIds.has(Number(medId)))return;recordLock.current=true;setRecording(medId);
    try{const response=await apiFetch('/residents/'+encodeURIComponent(residentId)+'/medication-events',{method:'POST',body:JSON.stringify({medicationId:Number(medId),day:colomboDay(),status})}),data=await response.json();if(!response.ok)throw Error(data.error||'Your check-in could not be saved.');await cancelLocalDoseReminder('checkin:'+medId);await fetchMedications();}
    catch(error){Alert.alert('Could Not Save',error.message);}finally{recordLock.current=false;setRecording(null);}
  };
  const remind=async med=>{try{await remindMedicationCheckin(med.id);Alert.alert('Reminder set','We will ask you to review your medication instructions in 10 minutes.');}catch(error){Alert.alert('Reminder unavailable',error.message);}};

  const handleFinishMed = (med) => {
    Alert.alert(
      'Finish Medication',
      `Mark "${med.drugName}" as permanently finished? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Finish', style: 'destructive',
          onPress: async () => {
            try {
              const res = await apiFetch(`/prescriptions/${med.prescriptionId}/medications`, {
                method: 'DELETE',
                body: JSON.stringify({ medicationId:Number(med.id), drugName: med.drugName, dosage: med.dosage, frequency: med.frequency }),
              });
              if (!res.ok) throw new Error('Failed');
              Alert.alert('Done', `${med.drugName} marked as finished.`);
              fetchMedications();
            } catch (err) {
              Alert.alert('Error', 'Could not finish medication.');
            }
          }
        }
      ]
    );
  };

  const checkInMedications = medications.filter(m => !scheduledMedicationIds.has(Number(m.id)));
  const takenCount = checkInMedications.filter(m => takenIds.has(m.id)).length;
  const totalCount = medications.length;
  const progress = checkInMedications.length > 0 ? Math.round((takenCount / checkInMedications.length) * 100) : 0;

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}><ActivityIndicator size="large" color="#6D38FF" /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#171459" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Medications</Text>
        <TouchableOpacity onPress={fetchMedications} style={styles.refreshBtn}>
          <MaterialCommunityIcons name="refresh" size={22} color="#6D38FF" />
        </TouchableOpacity>
      </View>

      <RequestError message={loadError} onRetry={fetchMedications} />
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchMedications(); }} colors={["#6D38FF"]} />}
      >
        <NextDoseCountdown residentId={residentId}/>
        {/* Summary Card */}
        <View style={styles.summaryCard}>
          <View pointerEvents="none" style={styles.heroOrb} />
          <View pointerEvents="none" style={styles.heroOrbSmall} />
          <Text style={styles.heroEyebrow}>YOUR DAILY ROUTINE</Text>
          <View style={styles.summaryContent}>
            <View style={styles.heroCopy}>
              <Text style={styles.summaryTitle}>Daily Check-ins</Text>
              <Text style={styles.summarySubtitle}>{takenCount} of {checkInMedications.length} untimed medications checked today</Text>
            </View>
            <View style={styles.progressCircle}>
              <Text style={styles.progressText}>{progress}%</Text>
            </View>
          </View>
        </View>

        <DoseReminders residentId={residentId} medications={medications} onSchedulesLoaded={schedulesLoaded} />
        <Text style={styles.sectionTitle}>Active Prescriptions</Text>

        {!loadError && totalCount === 0 ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="pill-off" size={48} color="#A2A4C3" />
            <Text style={styles.emptyTitle}>No Active Medications</Text>
            <Text style={styles.emptySubtitle}>Upload a prescription to get started.</Text>
            <TouchableOpacity style={styles.uploadBtn} onPress={() => navigation.navigate('UploadRx')}>
              <MaterialCommunityIcons name="camera-plus" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={styles.uploadBtnText}>Upload Prescription</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.medList}>
            {medications.map((med) => {
              const timed = scheduledMedicationIds.has(Number(med.id));
              const taken = !timed && takenIds.has(med.id);
              return (
                <TouchableOpacity key={med.id} style={styles.medCard} onLongPress={() => handleFinishMed(med)} activeOpacity={0.7}>
                  <View style={[styles.iconContainer, taken ? { backgroundColor: '#D1FAE5' } : { backgroundColor: '#EDF2EE' }]}>
                    <MaterialCommunityIcons name="pill" size={28} color={taken ? '#059669' : '#788C82'} />
                  </View>
                  
                  <View style={styles.medInfo}>
                    <Text style={[styles.drugName, taken && styles.drugNameTaken]}>{med.drugName}</Text>
                    <Text style={styles.dosage}>{med.dosage || 'No dosage specified'}</Text>
                    <Text style={styles.frequency}>{med.frequency || 'As directed'}</Text>
                  </View>

                  {timed ? <Text style={styles.frequency}>Use timed dose actions</Text> : <View><Text style={{fontSize:12,color:'#64748B'}}>{taken?'Taken':skippedIds.has(Number(med.id))?'Skipped':'Not recorded'}</Text><View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{[['Taken',()=>toggleTaken(med.id)],['Skip',()=>recordMedication(med.id,'skipped')],['Remind',()=>remind(med)]].map(([label,action])=><TouchableOpacity key={label} disabled={recording!=null||!med.confirmed} accessibilityLabel={label+' '+med.drugName} onPress={action}><Text style={{paddingVertical:14,color:med.confirmed?'#6D38FF':'#64748B',fontSize:12}}>{label}</Text></TouchableOpacity>)}</View></View>}
                </TouchableOpacity>
              );
            })}
            <Text style={styles.hintText}>Long-press a medication to mark it as permanently finished.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F6F5FF"
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 18,
    backgroundColor: "#F6F5FF",
    borderBottomWidth: 0,
    borderBottomColor: "#EEE9FF"
  },
  backBtn: {
    minHeight: 44,
    minWidth: 44,
    padding: 8,
    backgroundColor: "#EEE9FF",
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    width: 46,
    height: 46
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#171459",
    lineHeight: 27,
    letterSpacing: -0.7
  },
  refreshBtn: {
    padding: 8,
    backgroundColor: "#EEE9FF",
    borderRadius: 17,
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    width: 46,
    height: 46
  },
  scrollContainer: {
    padding: 20,
    paddingBottom: 44
  },
  summaryCard: {
    backgroundColor: "#171459",
    borderRadius: 32,
    padding: 24,
    marginBottom: 26,
    shadowColor: "#171459",
    shadowOffset: {
      width: 0,
      height: 8
    },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 5,
    minHeight: 182,
    overflow: "hidden"
  },
  summaryContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  summaryTitle: {
    fontSize: 29,
    fontWeight: "800",
    color: '#FFFFFF',
    marginBottom: 9,
    lineHeight: 34,
    letterSpacing: -1
  },
  summarySubtitle: {
    fontSize: 14,
    color: "#DAD9FF",
    fontWeight: '500',
    lineHeight: 22
  },
  progressCircle: {
    width: 76,
    height: 76,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: "#A6A6FF",
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: "#6D38FF",
    marginLeft: 10
  },
  progressText: {
    color: '#FFFFFF',
    fontWeight: "800",
    fontSize: 21
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#171459",
    marginBottom: 16,
    lineHeight: 29,
    letterSpacing: -0.6
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 36,
    backgroundColor: "#FFFFFF",
    borderWidth: 0,
    borderColor: "#E4E3F4",
    borderRadius: 30,
    padding: 26,
    marginTop: 12
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#171459",
    marginTop: 16,
    marginBottom: 4,
    lineHeight: 27,
    letterSpacing: -0.4
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#6B6F91",
    marginBottom: 20,
    lineHeight: 23,
    textAlign: "center"
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: "#171459",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 18,
    minHeight: 52
  },
  uploadBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15
  },
  medList: {
    gap: 15
  },
  medCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 18,
    borderRadius: 26,
    borderWidth: 0,
    borderColor: "#EEE9FF",
    shadowColor: "#171459",
    shadowOffset: {
      width: 0,
      height: 4
    },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1
  },
  iconContainer: {
    width: 56,
    height: 64,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 13
  },
  medInfo: {
    flex: 1
  },
  drugName: {
    fontSize: 19,
    fontWeight: "800",
    color: "#171459",
    marginBottom: 4,
    lineHeight: 25,
    letterSpacing: -0.45
  },
  drugNameTaken: {
    color: "#6B6F91",
    textDecorationLine: 'line-through'
  },
  dosage: {
    fontSize: 14,
    fontWeight: '600',
    color: "#5355B7",
    marginBottom: 4,
    lineHeight: 20
  },
  frequency: {
    fontSize: 13,
    color: "#6B6F91",
    lineHeight: 19
  },
  actionBtn: {
    padding: 8,
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center"
  },
  hintText: {
    fontSize: 12,
    color: "#8287A7",
    textAlign: 'center',
    marginTop: 8,
    fontStyle: "normal",
    lineHeight: 19,
    paddingHorizontal: 14
  },
  closeBtn: {
    width: 46,
    height: 46,
    borderRadius: 17,
    backgroundColor: "#EEE9FF"
  },
  listContainer: {
    gap: 16
  },
  bannerCard: {
    backgroundColor: "#171459",
    borderRadius: 32,
    padding: 24,
    minHeight: 178,
    marginBottom: 26,
    borderWidth: 0,
    shadowColor: "#171459",
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 5,
    overflow: "hidden"
  },
  bannerTitle: {
    fontSize: 29,
    lineHeight: 34,
    letterSpacing: -1,
    fontWeight: "800",
    color: "#FFFFFF",
    marginBottom: 9
  },
  bannerSubtitle: {
    fontSize: 14,
    lineHeight: 22,
    color: "#DAD9FF",
    fontWeight: "500"
  },
  heroCopy: {
    flex: 1,
    paddingRight: 12
  },
  heroEyebrow: {
    fontSize: 10,
    fontWeight: "800",
    color: "#BEBEFF",
    letterSpacing: 2,
    marginBottom: 13
  },
  heroOrb: {
    position: "absolute",
    width: 156,
    height: 156,
    borderRadius: 78,
    top: -68,
    right: -46,
    backgroundColor: "#6D38FF",
    opacity: 0.24
  },
  heroOrbSmall: {
    position: "absolute",
    width: 70,
    height: 70,
    borderRadius: 35,
    right: 35,
    bottom: -38,
    backgroundColor: "#FFB85C",
    opacity: 0.72
  },
  submitBtn: {
    backgroundColor: "#171459",
    borderRadius: 20,
    minHeight: 56,
    shadowColor: "#171459",
    shadowOpacity: 0.12
  },
  confirmBtn: {
    backgroundColor: "#171459",
    borderRadius: 20,
    minHeight: 56
  }
});

export default MedicationsScreen;
