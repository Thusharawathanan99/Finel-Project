import RequestError from '../components/RequestError';
import DoseReminders from '../components/DoseReminders';
import {useScreenRefresh} from '../useScreenRefresh';
import {normalizeMealPlan} from '../mealPlanAdapter';
import {calendarDateKey, parseCalendarDate, localDateKey} from '../calendar';
import { apiFetch } from '../apiHelper';
import { wellnessScore, wellnessStyle } from '../careSummary';
import React, { useState, useRef, useCallback } from 'react';
import { Image, View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, TextInput, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';

const PatientProfileScreen = ({ route, navigation }) => {
  // Get patient data from navigation parameters
  const { patient } = route.params || { patient: { name: 'Kalani', room: '101', age: 72 } };

  const [activeTab, setActiveTab] = useState('meds');

  // State variables for real data
  const [residentDetails, setResidentDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mealPlan, setMealPlan] = useState(null);
  const [mealPlanLoading, setMealPlanLoading] = useState(true);
  const [appointments, setAppointments] = useState([]);
  const [showApptModal, setShowApptModal] = useState(false);
  const [apptForm, setApptForm] = useState({ doctorName: '', specialization: '', date: '', time: '', reason: '' });
  const [doctors, setDoctors] = useState([]);
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [showWellnessLog, setShowWellnessLog] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [pickedDate, setPickedDate] = useState(new Date());
  const [pickedTime, setPickedTime] = useState(new Date());
  const [loadError, setLoadError] = useState(null);
  const [booking, setBooking] = useState(false);
  const bookingLock = useRef(false);
  const [generatingPlan,setGeneratingPlan] = useState(false);
  const generationLock=useRef(false);
  const regeneratePlan=async()=>{
    if(generationLock.current)return;generationLock.current=true;setGeneratingPlan(true);
    try{const residentId=patient.resident_id||patient.id,response=await apiFetch('/generate-meal-plan',{method:'POST',body:JSON.stringify({residentId,prompt:'Generate a complete seven-day draft meal plan using the current resident records.'})}),data=await response.json();
      if(!response.ok)throw Error(data.error||'Meal planning unavailable.');
      const saved=await apiFetch('/residents/'+encodeURIComponent(residentId)+'/meal-plan',{method:'POST',body:JSON.stringify({plan:data.canonicalPlan||data.plan})});const result=await saved.json();if(!saved.ok)throw Error(result.error||'The meal plan could not be saved.');
      await fetchResidentDetails();
    }catch(e){Alert.alert('Meal plan not saved',e.message);}finally{generationLock.current=false;setGeneratingPlan(false);}
  };

  const fetchResidentDetails = useCallback(async () => {
    setLoadError(null);
      try {
        const { auth } = require('../firebase/config');
        const token = await auth.currentUser?.getIdToken();
        const res = await apiFetch(`/residents/${patient.resident_id || patient.id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Failed to fetch details');
        const data = await res.json();
        setResidentDetails(data);
      } catch (err) {
        setLoadError('Some care records could not be loaded. Check your connection and try again.');
        console.error('Fetch error:', err);
      } finally {
        setLoading(false);
      }

      // Fetch meal plan
      try {
        const { auth } = require('../firebase/config');
        const token = await auth.currentUser?.getIdToken();
        const mealRes = await apiFetch(`/residents/${patient.resident_id || patient.id}/meal-plan`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!mealRes.ok) throw new Error('Meal plan unavailable');
        if (mealRes.ok) {
          const mealData = await mealRes.json();
          setMealPlan(normalizeMealPlan(mealData.plan));
        }
      } catch (err) {
        setLoadError('Some care records could not be loaded. Check your connection and try again.');
        console.warn('Meal plan fetch error:', err);
      } finally {
        setMealPlanLoading(false);
      }

      // Fetch appointments
      try {
        const { auth } = require('../firebase/config');
        const token = await auth.currentUser?.getIdToken();
        const apptRes = await apiFetch(`/residents/${patient.resident_id || patient.id}/appointments`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!apptRes.ok) throw new Error('Appointments unavailable');
        if (apptRes.ok) {
          const apptData = await apptRes.json();
          setAppointments(apptData);
        }
      } catch (err) {
        setLoadError('Some care records could not be loaded. Check your connection and try again.');
        console.warn('Appointments fetch error:', err);
      }

      // Fetch registered doctors
      try {
        const { auth } = require('../firebase/config');
        const token = await auth.currentUser?.getIdToken();
        const docRes = await apiFetch('/doctors', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!docRes.ok) throw new Error('Doctor list unavailable');
        if (docRes.ok) {
          const docData = await docRes.json();
          setDoctors(docData.filter(d => d.is_active));
        }
      } catch (err) {
        setLoadError('Some care records could not be loaded. Check your connection and try again.');
        console.warn('Doctors fetch error:', err);
      }
  }, [patient]);
  useScreenRefresh(navigation, fetchResidentDetails);

  const displayRoom = residentDetails?.room_number ?? patient.room_number ?? patient.room ?? 'TBD';

  // Extract medications from prescriptions
  const medications = [];
  if (residentDetails?.prescriptions) {
    residentDetails.prescriptions.forEach(rx => {
      if (rx.medications) {
        rx.medications.forEach(med => {
          medications.push({ ...med, prescription_id: rx.prescription_id });
        });
      }
    });
  }

  const handleFinishMedication = async (med) => {
    try {
      const { auth } = require('../firebase/config');
      const token = await auth.currentUser?.getIdToken();
      const res = await apiFetch(`/prescriptions/${med.prescription_id}/medications`, {
        method: 'DELETE',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ medicationId: med.id })
      });
      if (!res.ok) throw new Error('Failed to finish medication');
      
      // Optimistically update UI by refetching
      const refreshRes = await apiFetch(`/residents/${patient.resident_id || patient.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!refreshRes.ok) throw new Error('Records could not be refreshed');
      const data = await refreshRes.json();
      setResidentDetails(data);
      await fetchResidentDetails();
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Error marking medication as finished');
    }
  };

  const handleBookAppointment = async () => {
    if (bookingLock.current) return;
    if (!apptForm.doctorName || !apptForm.date) {
      Alert.alert('Missing Info', 'Please enter doctor name and date.');
      return;
    }
    if (calendarDateKey(apptForm.date) !== apptForm.date || apptForm.date < localDateKey()) { Alert.alert('Check Date', 'Choose a valid appointment date today or later.'); return; }
    bookingLock.current = true; setBooking(true);
    try {
      const { auth } = require('../firebase/config');
      const token = await auth.currentUser?.getIdToken();
      const res = await apiFetch('/appointments', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          residentId: patient.resident_id || patient.id,
          residentName: patient.name,
          doctorName: apptForm.doctorName,
          specialization: apptForm.specialization,
          appointmentDate: apptForm.date,
          appointmentTime: apptForm.time,
          reason: apptForm.reason,
        }),
      });
      if (!res.ok) throw new Error('Failed to book');
      const data = await res.json();
      setAppointments(prev => [{ appointment_id: data.appointmentId, doctor_name: apptForm.doctorName, specialization: apptForm.specialization, appointment_date: apptForm.date, appointment_time: apptForm.time, reason: apptForm.reason, status: 'scheduled' }, ...prev]);
      setApptForm({ doctorName: '', specialization: '', date: '', time: '', reason: '' });
      setShowApptModal(false);
      Alert.alert('Success', 'Appointment booked!');
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Failed to book appointment.');
    } finally { bookingLock.current = false; setBooking(false); }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('PatientList')} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#171459" />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>{patient.name}</Text>
          <Text style={styles.headerSubtitle}>Room {displayRoom} • {patient.age} yrs</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        <RequestError message={loadError} onRetry={fetchResidentDetails} />
        
        <View style={styles.profileHero}>
          <Text style={{color:'white',marginBottom:10}}>{medications.length} medications · {residentDetails?.prescriptions?.length??0} prescriptions · Wellness {wellnessScore(residentDetails?.emotionalStates?.[0])??'Not recorded'}</Text>
          <View style={styles.profileTopline}><Text style={styles.profileEyebrow}>A PERSON. A PLAN. CONNECTED CARE.</Text><MaterialCommunityIcons name="star-four-points" size={18} color="#FF887D" /></View>
          <View style={styles.profileIdentity}><View style={styles.profileAvatar}><Text style={styles.profileInitial}>{patient.name?.charAt(0) || 'C'}</Text></View><View style={{ flex: 1 }}><Text style={styles.profileName}>{patient.name}</Text><Text style={styles.profileDetails}>Room {displayRoom} • {patient.age} yrs</Text><View style={styles.profilePill}><MaterialCommunityIcons name="heart-outline" size={12} color="#171459" /><Text style={styles.profilePillText}>Your care circle</Text></View></View></View>
        </View>
        <Text style={styles.quickTitle}>A little help, right here.</Text>
        {/* Quick Actions (Rx, Appt, Meals) */}
        <View style={styles.quickActionsRow}>
          <TouchableOpacity 
            style={[styles.actionBtn, { backgroundColor: '#3478FF' }]}
            onPress={() => navigation.navigate('UploadRx', { patient })}
          >
            <MaterialCommunityIcons name="file-document-outline" size={20} color="#FFF" />
            <Text style={styles.actionText}>Upload Rx</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.actionBtn, { backgroundColor: '#6D38FF' }]}
            onPress={() => setActiveTab('appts')}
          >
            <MaterialCommunityIcons name="calendar-clock" size={20} color="#FFF" />
            <Text style={styles.actionText}>Appointments</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.actionBtn, { backgroundColor: '#FF887D' }]}
            onPress={() => setActiveTab('diet')}
          >
            <MaterialCommunityIcons name="silverware-fork-knife" size={20} color="#FFF" />
            <Text style={styles.actionText}>Meals</Text>
          </TouchableOpacity>
        </View>

        {/* Tab Navigation */}
        <View style={styles.tabsContainer}>
          <TouchableOpacity 
            style={[styles.tab, activeTab === 'meds' && styles.tabActive]}
            onPress={() => setActiveTab('meds')}
          >
            <Text style={[styles.tabText, activeTab === 'meds' && styles.tabTextActive]}>Current Meds ({medications.length})</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.tab, activeTab === 'history' && styles.tabActive]}
            onPress={() => setActiveTab('history')}
          >
            <Text style={[styles.tabText, activeTab === 'history' && styles.tabTextActive]}>History ({residentDetails?.finishedMedications?.length || 0})</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.tab, activeTab === 'appts' && styles.tabActive]}
            onPress={() => setActiveTab('appts')}
          >
            <Text style={[styles.tabText, activeTab === 'appts' && styles.tabTextActive]}>Appointments ({appointments.length})</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.tab, activeTab === 'diet' && styles.tabActive]}
            onPress={() => setActiveTab('diet')}
          >
            <Text style={[styles.tabText, activeTab === 'diet' && styles.tabTextActive]}>Diet Plan</Text>
          </TouchableOpacity>
        </View>

        {/* Tab Content */}
        <View style={styles.tabContent}>
          {activeTab === 'meds' && (
            <View>
              <DoseReminders residentId={patient.resident_id || patient.id} medications={medications} />
              {loading && <Text style={styles.emptyText}>Loading medications…</Text>}
              {!loading && !loadError && medications.length === 0 && <Text style={styles.emptyText}>No active medications.</Text>}
              {medications.map((med) => (
                <View key={med.id} style={styles.medCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.medName}>{med.drug_name}</Text>
                    <Text style={styles.medDetails}>{med.dosage} • {med.frequency}</Text>
                    {Boolean(med.duration) && <Text style={{ fontSize: 12, color: '#6D38FF', marginTop: 2 }}>Duration: {med.duration}</Text>}
                    {Boolean(med.instructions) && <Text style={{ fontSize: 12, color: '#475569', marginTop: 2, fontStyle: 'italic' }}>{med.instructions}</Text>}
                  </View>
                  <TouchableOpacity 
                    style={styles.finishBtn}
                    onPress={() => handleFinishMedication(med)}
                  >
                    <Text style={styles.finishText}>Finish</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {activeTab === 'history' && (
            <View>
              {(!residentDetails?.finishedMedications || residentDetails.finishedMedications.length === 0) ? (
                <View style={styles.emptyState}>
                  <MaterialCommunityIcons name="history" size={48} color="#CBD5E1" />
                  <Text style={styles.emptyText}>{loadError ? 'History unavailable. Please retry.' : 'No history available.'}</Text>
                </View>
              ) : (
                residentDetails.finishedMedications.map((historyItem) => (
                  <View key={historyItem.id} style={styles.medCard}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.medName}>{historyItem.drug_name}</Text>
                      <Text style={styles.medDetails}>Finished: {new Date(historyItem.finished_at).toLocaleString()}</Text>
                    </View>
                    <MaterialCommunityIcons name="check-circle" size={24} color="#10B981" />
                  </View>
                ))
              )}
            </View>
          )}

          {activeTab === 'diet' && (
            <View>
              <TouchableOpacity disabled={generatingPlan} onPress={regeneratePlan} style={{padding:16,borderRadius:12,backgroundColor:'#6D38FF',marginBottom:12}}><Text style={{color:'white',fontWeight:'700',textAlign:'center'}}>{generatingPlan?'Generating…':'Generate / regenerate 7-day plan'}</Text></TouchableOpacity><Text style={{color:'#64748B',marginBottom:12}}>Review the draft against medication instructions, allergies and the resident's care plan.</Text>
              {mealPlanLoading ? (
                <View style={styles.emptyState}>
                  <MaterialCommunityIcons name="food-apple-outline" size={48} color="#CBD5E1" />
                  <Text style={styles.emptyText}>Loading diet plan...</Text>
                </View>
              ) : !mealPlan ? (
                <View style={styles.emptyState}>
                  <MaterialCommunityIcons name="food-off-outline" size={48} color="#CBD5E1" />
                  <Text style={styles.emptyText}>{loadError ? 'Meal plan unavailable. Please retry.' : 'No diet plan generated yet.'}</Text>
                  <Text style={{ color: '#9496AA', fontSize: 12, marginTop: 4 }}>Use the generate button above.</Text>
                </View>
              ) : (
                <View>
                  {/* Clinical Notes */}
                  {mealPlan.clinicalNotes.length > 0 && (
                    <View style={{ backgroundColor: '#F6F5FF', borderRadius: 16, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: '#EEEBFF' }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#171459', marginBottom: 6 }}>📋 Clinical Notes</Text>
                      <Text style={{ fontSize: 12, color: '#334155', lineHeight: 18 }}>{mealPlan.clinicalNotes.join('\n')}</Text>
                    </View>
                  )}

                  {/* Nutrition Summary */}
                  {mealPlan.nutrition && (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                      {Object.entries(mealPlan.nutrition).map(([k, v]) => (
                        <View key={k} style={{ backgroundColor: '#FFF7ED', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#FED7AA' }}>
                          <Text style={{ fontSize: 14, fontWeight: '800', color: '#C2410C' }}>{String(v)}</Text>
                          <Text style={{ fontSize: 10, fontWeight: '600', color: '#9A3412', textTransform: 'capitalize' }}>{k}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Days with meals */}
                  {mealPlan.days && (
                    Object.entries(mealPlan.days).map(([day, dayData]) => {
                      const meals = dayData?.meals || (Array.isArray(dayData) ? dayData : []);
                      if (!meals.length) return null;
                      return (
                        <View key={day} style={{ marginBottom: 16 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 6 }}>
                            <View style={{ backgroundColor: '#6D38FF', width: 28, height: 28, borderRadius: 8, justifyContent: 'center', alignItems: 'center' }}>
                              <Text style={{ color: '#FFF', fontSize: 10, fontWeight: '800' }}>{day.slice(0, 2).toUpperCase()}</Text>
                            </View>
                            <Text style={{ fontSize: 15, fontWeight: '800', color: '#171459' }}>{day}</Text>
                            <Text>{dayData.nutrition?.calories ?? '—'} cal</Text>
                          </View>
                          {meals.map((meal, idx) => (
                            <View key={idx} style={{ backgroundColor: '#FFF', borderRadius: 14, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#E6E1FB', flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                              <View style={{ backgroundColor: meal.label === 'Breakfast' ? '#FEF3C7' : meal.label === 'Lunch' ? '#EEEBFF' : meal.label === 'Dinner' ? '#EDE9FE' : '#DCFCE7', width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' }}>
                                <Text style={{ fontSize: 16 }}>{meal.label === 'Breakfast' ? '🌅' : meal.label === 'Lunch' ? '☀️' : meal.label === 'Dinner' ? '🌙' : '🍎'}</Text>
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text style={{ fontSize: 13, fontWeight: '700', color: '#171459' }}>{meal.name || meal.meal || 'Meal'}</Text>
                                {meal.label && <Text style={{ fontSize: 10, fontWeight: '600', color: '#73758E', marginTop: 1 }}>{meal.label}</Text>}
                                {Array.isArray(meal.warnings) && meal.warnings.map((warning,index)=><Text key={index} style={{color:'#991B1B',marginTop:6}}>⚠ {warning}</Text>)}
                                {meal.description && <Text style={{ fontSize: 11, color: '#73758E', marginTop: 3, lineHeight: 16 }} numberOfLines={2}>{meal.description}</Text>}
                                {meal.calories && <Text style={{ fontSize: 11, fontWeight: '700', color: '#F97316', marginTop: 3 }}>🔥 {meal.calories} cal</Text>}
                              </View>
                            </View>
                          ))}
                        </View>
                      );
                    })
                  )}

                  {/* Simple fallback for flat meal structures */}
                  {!mealPlan.days && ['breakfast', 'lunch', 'dinner', 'snacks'].map(mealType => {
                    const meals = mealPlan[mealType];
                    if (!meals) return null;
                    return (
                      <View key={mealType} style={{ marginBottom: 14 }}>
                        <Text style={{ fontSize: 14, fontWeight: '700', color: '#171459', marginBottom: 6, textTransform: 'capitalize' }}>{mealType}</Text>
                        {(Array.isArray(meals) ? meals : [meals]).map((item, idx) => (
                          <View key={idx} style={styles.medCard}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.medName}>{typeof item === 'string' ? item : item.name || JSON.stringify(item)}</Text>
                            </View>
                          </View>
                        ))}
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          )}

          {activeTab === 'appts' && (
            <View>
              {appointments.length === 0 ? (
                <View style={styles.emptyState}>
                  <MaterialCommunityIcons name="calendar-blank-outline" size={48} color="#CBD5E1" />
                  <Text style={styles.emptyText}>{loadError ? 'Appointments unavailable. Please retry.' : 'No appointments yet.'}</Text>
                </View>
              ) : (
                appointments.map((apt) => (
                  <View key={apt.appointment_id} style={{ backgroundColor: '#FFF', borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#E6E1FB', flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                    <View style={{ backgroundColor: '#ECFDF5', width: 44, height: 44, borderRadius: 14, justifyContent: 'center', alignItems: 'center' }}>
                      <MaterialCommunityIcons name="calendar-check" size={22} color="#10B981" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: '#171459' }}>Dr. {apt.doctor_name}</Text>
                      <Text style={{ fontSize: 11, color: '#73758E', marginTop: 1 }}>{apt.specialization}</Text>
                      <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
                        <Text style={{ fontSize: 11, color: '#6D38FF', fontWeight: '600' }}>📅 {parseCalendarDate(apt.appointment_date)?.toLocaleDateString() || 'Date unavailable'}</Text>
                        {apt.appointment_time && <Text style={{ fontSize: 11, color: '#6D38FF', fontWeight: '600' }}>🕐 {apt.appointment_time}</Text>}
                      </View>
                      {apt.reason && <Text style={{ fontSize: 11, color: '#9496AA', marginTop: 3 }}>{apt.reason}</Text>}
                    </View>
                    <View style={{ backgroundColor: apt.status === 'completed' ? '#DCFCE7' : apt.status === 'cancelled' ? '#FEE2E2' : '#EEEBFF', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                      <Text style={{ fontSize: 9, fontWeight: '700', color: apt.status === 'completed' ? '#166534' : apt.status === 'cancelled' ? '#991B1B' : '#1E40AF', textTransform: 'uppercase' }}>{apt.status || 'scheduled'}</Text>
                    </View>
                  </View>
                ))
              )}
              <TouchableOpacity 
                style={{ backgroundColor: '#10B981', borderRadius: 16, padding: 14, marginTop: 8, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }}
                onPress={() => setShowApptModal(true)}
              >
                <MaterialCommunityIcons name="plus" size={20} color="#FFF" />
                <Text style={{ color: '#FFF', fontSize: 15, fontWeight: '700' }}>{booking ? 'Booking…' : 'Book Appointment'}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Emotional Wellness Section */}
        <View style={styles.wellnessSection}>
          <Text style={styles.sectionTitle}>Emotional Wellness</Text>
          
          {residentDetails?.emotionalStates && residentDetails.emotionalStates.length > 0 ? (
            <TouchableOpacity onPress={() => setShowWellnessLog(true)} activeOpacity={0.7}>
              <View style={styles.wellnessCard}>
                <View style={styles.emotionIcon}>
                  <MaterialCommunityIcons 
                    name={residentDetails.emotionalStates[0].emotion_label === 'Happy' ? 'emoticon-happy-outline' : 
                          residentDetails.emotionalStates[0].emotion_label === 'Sad' ? 'emoticon-sad-outline' : 
                          'emoticon-neutral-outline'} 
                    size={32} 
                    color={residentDetails.emotionalStates[0].emotion_label === 'Happy' ? '#10B981' : '#F59E0B'} 
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.wellnessStatus}>Feeling {residentDetails.emotionalStates[0].emotion_label}</Text>
                  <Text style={styles.wellnessTime}>{new Date(residentDetails.emotionalStates[0].recorded_at).toLocaleString()}</Text>
                  {residentDetails.emotionalStates[0].clinical_notes && (
                    <Text style={{ fontSize: 11, color: '#73758E', marginTop: 2 }} numberOfLines={2}>{residentDetails.emotionalStates[0].clinical_notes}</Text>
                  )}
                </View>
                <View style={{ alignItems: 'center' }}>
                  <MaterialCommunityIcons name="chevron-right" size={22} color="#9496AA" />
                  <Text style={styles.viewLogText}>View Log</Text>
                </View>
              </View>
            </TouchableOpacity>
          ) : (
            <Text style={styles.emptyText}>{loadError ? 'Wellness history unavailable. Please retry.' : 'No wellness logs recorded.'}</Text>
          )}
        </View>

      </ScrollView>

      {/* Appointment Booking Modal */}
      <Modal visible={showApptModal} animationType="slide" transparent onRequestClose={() => { setShowApptModal(false); setSelectedDoctor(null); }}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, maxHeight: '90%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ fontSize: 20, fontWeight: '800', color: '#171459' }}>Book Appointment</Text>
              <TouchableOpacity onPress={() => { setShowApptModal(false); setSelectedDoctor(null); }} style={{ padding: 4 }}>
                <MaterialCommunityIcons name="close" size={24} color="#73758E" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Doctor Picker */}
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#475569', marginBottom: 10 }}>Select Doctor</Text>
              {doctors.length > 0 ? (
                <View style={{ marginBottom: 16 }}>
                  {doctors.map(doc => (
                    <TouchableOpacity
                      key={doc.doctor_id}
                      onPress={() => {
                        setSelectedDoctor(doc);
                        setApptForm(p => ({ ...p, doctorName: doc.name, specialization: doc.specialization || '' }));
                      }}
                      style={{
                        flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 14,
                        marginBottom: 8, borderWidth: 2, gap: 12,
                        borderColor: selectedDoctor?.doctor_id === doc.doctor_id ? '#6D38FF' : '#E6E1FB',
                        backgroundColor: selectedDoctor?.doctor_id === doc.doctor_id ? '#F6F5FF' : '#FFF',
                      }}
                    >
                      <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: selectedDoctor?.doctor_id === doc.doctor_id ? '#6D38FF' : '#EEEBFF', justifyContent: 'center', alignItems: 'center' }}>
                        <Text style={{ fontSize: 18, fontWeight: '800', color: selectedDoctor?.doctor_id === doc.doctor_id ? '#FFF' : '#73758E' }}>{doc.name.charAt(0)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, fontWeight: '700', color: '#171459' }}>Dr. {doc.name}</Text>
                        <Text style={{ fontSize: 11, color: '#73758E' }}>{doc.specialization || 'General'}{doc.hospital ? ` • ${doc.hospital}` : ''}</Text>
                      </View>
                      {selectedDoctor?.doctor_id === doc.doctor_id && (
                        <MaterialCommunityIcons name="check-circle" size={22} color="#6D38FF" />
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              ) : (
                <View style={{ alignItems: 'center', paddingVertical: 20, marginBottom: 12 }}>
                  <MaterialCommunityIcons name="doctor" size={36} color="#CBD5E1" />
                  <Text style={{ color: '#9496AA', fontSize: 12, marginTop: 6 }}>{loadError ? 'Doctor list unavailable. Please retry.' : 'No doctors registered. Ask admin to add doctors.'}</Text>
                </View>
              )}

              {/* Date & Time */}
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#475569', marginBottom: 8 }}>Appointment Details</Text>
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
                {Platform.OS === 'web' ? (
                  <>
                    <View style={{ flex: 1, borderWidth: 1, borderColor: '#E6E1FB', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#F6F5FF', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <MaterialCommunityIcons name="calendar" size={18} color="#6D38FF" />
                      {React.createElement('input', {
                        type: 'date',
                        value: apptForm.date,
                        min: localDateKey(),
                        onChange: (e) => setApptForm(p => ({ ...p, date: e.target.value })),
                        style: {
                          flex: 1,
                          fontSize: 14,
                          color: '#171459',
                          outline: 'none',
                          border: 'none',
                          backgroundColor: 'transparent',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          fontWeight: '500',
                          width: '100%',
                        }
                      })}
                    </View>
                    <View style={{ flex: 1, borderWidth: 1, borderColor: '#E6E1FB', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#F6F5FF', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <MaterialCommunityIcons name="clock-outline" size={18} color="#6D38FF" />
                      {React.createElement('input', {
                        type: 'time',
                        value: apptForm.time,
                        onChange: (e) => setApptForm(p => ({ ...p, time: e.target.value })),
                        style: {
                          flex: 1,
                          fontSize: 14,
                          color: '#171459',
                          outline: 'none',
                          border: 'none',
                          backgroundColor: 'transparent',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          fontWeight: '500',
                          width: '100%',
                        }
                      })}
                    </View>
                  </>
                ) : (
                  <>
                    <TouchableOpacity onPress={() => setShowDatePicker(true)} style={{ flex: 1, borderWidth: 1, borderColor: '#E6E1FB', borderRadius: 12, padding: 14, backgroundColor: '#F6F5FF', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <MaterialCommunityIcons name="calendar" size={18} color="#6D38FF" />
                      <Text style={{ fontSize: 14, color: apptForm.date ? '#171459' : '#9496AA' }}>{apptForm.date || 'Select Date *'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setShowTimePicker(true)} style={{ flex: 1, borderWidth: 1, borderColor: '#E6E1FB', borderRadius: 12, padding: 14, backgroundColor: '#F6F5FF', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <MaterialCommunityIcons name="clock-outline" size={18} color="#6D38FF" />
                      <Text style={{ fontSize: 14, color: apptForm.time ? '#171459' : '#9496AA' }}>{apptForm.time || 'Select Time'}</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
              {showDatePicker && (
                <DateTimePicker
                  value={pickedDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  minimumDate={new Date()}
                  onChange={(event, selectedDate) => {
                    setShowDatePicker(Platform.OS === 'ios');
                    if (selectedDate) {
                      setPickedDate(selectedDate);
                      const y = selectedDate.getFullYear();
                      const m = String(selectedDate.getMonth() + 1).padStart(2, '0');
                      const d = String(selectedDate.getDate()).padStart(2, '0');
                      setApptForm(p => ({ ...p, date: `${y}-${m}-${d}` }));
                    }
                  }}
                />
              )}
              {showTimePicker && (
                <DateTimePicker
                  value={pickedTime}
                  mode="time"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(event, selectedTime) => {
                    setShowTimePicker(Platform.OS === 'ios');
                    if (selectedTime) {
                      setPickedTime(selectedTime);
                      const h = String(selectedTime.getHours()).padStart(2, '0');
                      const min = String(selectedTime.getMinutes()).padStart(2, '0');
                      setApptForm(p => ({ ...p, time: `${h}:${min}` }));
                    }
                  }}
                />
              )}
              <TextInput placeholder="Reason for visit" value={apptForm.reason} onChangeText={t => setApptForm(p => ({...p, reason: t}))} multiline numberOfLines={2} style={{ borderWidth: 1, borderColor: '#E6E1FB', borderRadius: 12, padding: 14, fontSize: 14, marginBottom: 16, backgroundColor: '#F6F5FF', textAlignVertical: 'top', minHeight: 60 }} />

              <TouchableOpacity onPress={handleBookAppointment} disabled={!selectedDoctor || booking} style={{ backgroundColor: selectedDoctor ? '#10B981' : '#CBD5E1', borderRadius: 16, padding: 16, alignItems: 'center', shadowColor: '#10B981', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 }}>
                <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '800' }}>{selectedDoctor ? `Book with Dr. ${selectedDoctor.name}` : 'Select a Doctor'}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Wellness Log Modal */}
      <Modal visible={showWellnessLog} animationType="slide" transparent onRequestClose={() => setShowWellnessLog(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, maxHeight: '85%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ fontSize: 20, fontWeight: '800', color: '#171459' }}>Wellness History</Text>
              <TouchableOpacity onPress={() => setShowWellnessLog(false)} style={{ padding: 4 }}>
                <MaterialCommunityIcons name="close" size={24} color="#73758E" />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {(residentDetails?.emotionalStates || []).slice(0,5).map((es, idx) => {
                const getEmoji = (label) => {
                  if (label === 'Happy') return { icon: 'emoticon-happy-outline', color: '#10B981', bg: '#ECFDF5' };
                  if (label === 'Sad') return { icon: 'emoticon-sad-outline', color: '#EF4444', bg: '#FEF2F2' };
                  if (label === 'Anxious') return { icon: 'emoticon-angry-outline', color: '#F59E0B', bg: '#FFFBEB' };
                  return { icon: 'emoticon-neutral-outline', color: '#6366F1', bg: '#EEF2FF' };
                };
                const emo = getEmoji(es.emotion_label);
                const score = wellnessScore(es),tone=wellnessStyle(score);
                return (
                  <View key={idx} style={{ backgroundColor: '#FFF', borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#EEEBFF' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                      <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: emo.bg, justifyContent: 'center', alignItems: 'center' }}>
                        <MaterialCommunityIcons name={emo.icon} size={24} color={emo.color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 15, fontWeight: '700', color: '#171459' }}>Feeling {es.emotion_label || 'Unknown'}</Text>
                        <Text style={{ fontSize: 11, color: '#9496AA' }}>{new Date(es.recorded_at).toLocaleString()}</Text>
                      </View>
                      <View style={{ backgroundColor: tone.background, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 }}>
                        <Text style={{ fontSize: 13, fontWeight: '800', color: tone.color }}>{score??'—'} · {tone.label}</Text>
                      </View>
                    </View>
                    {es.clinical_notes && (
                      <View style={{ backgroundColor: '#F6F5FF', borderRadius: 10, padding: 10, marginTop: 4 }}>
                        <Text style={{ fontSize: 12, color: '#475569', lineHeight: 18 }}>{es.clinical_notes}</Text>
                      </View>
                    )}
                  </View>
                );
              })}
              {(!residentDetails?.emotionalStates || residentDetails.emotionalStates.length === 0) && (
                <View style={{ alignItems: 'center', paddingVertical: 32 }}>
                  <MaterialCommunityIcons name="emoticon-neutral-outline" size={48} color="#CBD5E1" />
                  <Text style={{ color: '#9496AA', marginTop: 8 }}>{loadError ? 'Wellness history unavailable. Please retry.' : 'No wellness records found.'}</Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  headerTitleContainer: {
    flex: 1, alignItems: 'center', paddingHorizontal: 8,
  },
  headerTitle: {
    fontSize: 20, fontWeight: '800', color: '#171459', lineHeight: 28, letterSpacing: -0.6,
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#73758E',
    fontWeight: '500'
  },
  scrollContainer: {
    padding: 22, paddingBottom: 40,
  },
  quickActionsRow: {
    flexDirection: 'row', justifyContent: 'space-between', gap: 9, marginBottom: 24,
  },
  actionBtn: {
    flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingVertical: 18, borderRadius: 23, minHeight: 91, gap: 10,
  },
  actionText: {
    color: '#FFFFFF', fontWeight: '700', fontSize: 10, textAlign: 'center',
  },
  tabsContainer: {
    flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#EEEBFF', borderRadius: 21, padding: 5, marginBottom: 18, gap: 3,
  },
  tab: {
    flexGrow: 1, minWidth: '45%', paddingVertical: 12, paddingHorizontal: 8, alignItems: 'center', borderRadius: 16, minHeight: 44,
  },
  tabActive: { backgroundColor: '#6D38FF' },
  tabText: {
    fontSize: 11, fontWeight: '700', color: '#73758E',
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
  tabContent: {
    backgroundColor: '#FFFFFF', borderRadius: 27, padding: 20, marginBottom: 26, borderWidth: 1, borderColor: '#E6E1FB',
    shadowColor: '#171459', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.07, shadowRadius: 18, elevation: 3,
  },
  medCard: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 17, borderBottomWidth: 1, borderBottomColor: '#EEEBFF', gap: 12,
  },
  medName: {
    fontSize: 16, fontWeight: '800', color: '#171459', marginBottom: 7, lineHeight: 23,
  },
  medDetails: {
    fontSize: 12, color: '#73758E', lineHeight: 18,
  },
  finishBtn: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, backgroundColor: '#EEEBFF', minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center',
  },
  finishBtnDone: {
    backgroundColor: '#EEEBFF',
    borderColor: '#E6E1FB'
  },
  finishText: {
    color: '#6D38FF', fontSize: 11, fontWeight: '800',
  },
  finishTextDone: {
    color: '#9496AA'
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E6E1FB",
    borderRadius: 24,
    padding: 28,
    marginTop: 12
  },
  emptyText: {
    color: '#9496AA', marginTop: 8, fontSize: 13, lineHeight: 21, fontWeight: '500',
  },
  wellnessSection: {
    marginTop: 8
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#171459',
    marginBottom: 12,
    marginLeft: 4,
    lineHeight: 25,
    letterSpacing: -0.3
  },
  wellnessCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#E6EEFF', padding: 19, borderRadius: 26, gap: 12 },
  emotionIcon: {
    width: 52, height: 58, borderRadius: 19, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center',
  },
  wellnessStatus: {
    fontSize: 15, fontWeight: '800', color: '#171459', marginBottom: 5,
  },
  wellnessTime: {
    fontSize: 10, color: '#73758E', lineHeight: 16,
  },
  viewLogBtn: {
    padding: 8,
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center"
  },
  viewLogText: {
    color: '#6D38FF', fontWeight: '800', fontSize: 10,
  },
  profileHero: { backgroundColor: '#6D38FF', borderRadius: 30, padding: 23, marginBottom: 25, overflow: 'hidden' },
  profileTopline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 23 },
  profileEyebrow: { fontSize: 7, color: '#E3D8FF', fontWeight: '800', letterSpacing: 0.9 },
  profileIdentity: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  profileAvatar: { width: 76, height: 88, borderRadius: 27, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center', transform: [{ rotate: '-4deg' }] },
  profileInitial: { fontSize: 37, fontWeight: '800', color: '#6D38FF' },
  profileName: { fontSize: 26, lineHeight: 32, letterSpacing: -0.8, fontWeight: '800', color: '#FFFFFF' },
  profileDetails: { fontSize: 12, color: '#E3D8FF', marginTop: 6 },
  profilePill: { alignSelf: 'flex-start', backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 9, marginTop: 12, borderRadius: 12 },
  profilePillText: { fontSize: 9, fontWeight: '700', color: '#171459' },
  quickTitle: { fontSize: 17, fontWeight: '800', color: '#171459', marginBottom: 14, letterSpacing: -0.4 }
});

export default PatientProfileScreen;
