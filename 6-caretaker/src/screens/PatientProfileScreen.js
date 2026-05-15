import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, TextInput, Alert, Platform } from 'react-native';
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

  React.useEffect(() => {
    const fetchResidentDetails = async () => {
      try {
        const { auth } = require('../firebase/config');
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch(`https://api.careconnect.website/api/residents/${patient.resident_id || patient.id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Failed to fetch details');
        const data = await res.json();
        setResidentDetails(data);
      } catch (err) {
        console.error('Fetch error:', err);
      } finally {
        setLoading(false);
      }

      // Fetch meal plan
      try {
        const { auth } = require('../firebase/config');
        const token = await auth.currentUser?.getIdToken();
        const mealRes = await fetch(`https://api.careconnect.website/api/residents/${patient.resident_id || patient.id}/meal-plan`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (mealRes.ok) {
          const mealData = await mealRes.json();
          setMealPlan(mealData.plan || null);
        }
      } catch (err) {
        console.warn('Meal plan fetch error:', err);
      } finally {
        setMealPlanLoading(false);
      }

      // Fetch appointments
      try {
        const { auth } = require('../firebase/config');
        const token = await auth.currentUser?.getIdToken();
        const apptRes = await fetch(`https://api.careconnect.website/api/residents/${patient.resident_id || patient.id}/appointments`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (apptRes.ok) {
          const apptData = await apptRes.json();
          setAppointments(apptData);
        }
      } catch (err) {
        console.warn('Appointments fetch error:', err);
      }

      // Fetch registered doctors
      try {
        const { auth } = require('../firebase/config');
        const token = await auth.currentUser?.getIdToken();
        const docRes = await fetch('https://api.careconnect.website/api/doctors', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (docRes.ok) {
          const docData = await docRes.json();
          setDoctors(docData.filter(d => d.is_active));
        }
      } catch (err) {
        console.warn('Doctors fetch error:', err);
      }
    };
    fetchResidentDetails();
  }, [patient]);

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
      const res = await fetch(`https://api.careconnect.website/api/prescriptions/${med.prescription_id}/medications`, {
        method: 'DELETE',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ medicationId: med.id })
      });
      if (!res.ok) throw new Error('Failed to finish medication');
      
      // Optimistically update UI by refetching
      const refreshRes = await fetch(`https://api.careconnect.website/api/residents/${patient.resident_id || patient.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await refreshRes.json();
      setResidentDetails(data);
    } catch (err) {
      console.error(err);
      alert('Error marking medication as finished');
    }
  };

  const handleBookAppointment = async () => {
    if (!apptForm.doctorName || !apptForm.date) {
      Alert.alert('Missing Info', 'Please enter doctor name and date.');
      return;
    }
    try {
      const { auth } = require('../firebase/config');
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('https://api.careconnect.website/api/appointments', {
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
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#134E4A" />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>{patient.name}</Text>
          <Text style={styles.headerSubtitle}>Room {patient.room} • {patient.age} yrs</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        
        {/* Quick Actions (Rx, Appt, Meals) */}
        <View style={styles.quickActionsRow}>
          <TouchableOpacity 
            style={[styles.actionBtn, { backgroundColor: '#3B82F6' }]}
            onPress={() => navigation.navigate('UploadRx', { patient })}
          >
            <MaterialCommunityIcons name="file-document-outline" size={20} color="#FFF" />
            <Text style={styles.actionText}>Rx</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.actionBtn, { backgroundColor: '#10B981' }]}
            onPress={() => setActiveTab('appts')}
          >
            <MaterialCommunityIcons name="calendar-clock" size={20} color="#FFF" />
            <Text style={styles.actionText}>Appt</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.actionBtn, { backgroundColor: '#F97316' }]}
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
            <Text style={[styles.tabText, activeTab === 'meds' && styles.tabTextActive]}>Meds ({medications.length})</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.tab, activeTab === 'history' && styles.tabActive]}
            onPress={() => setActiveTab('history')}
          >
            <Text style={[styles.tabText, activeTab === 'history' && styles.tabTextActive]}>History ({residentDetails?.finishedMedications?.length || 0})</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.tab, activeTab === 'diet' && styles.tabActive]}
            onPress={() => setActiveTab('diet')}
          >
            <Text style={[styles.tabText, activeTab === 'diet' && styles.tabTextActive]}>Diet Plan</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.tab, activeTab === 'appts' && styles.tabActive]}
            onPress={() => setActiveTab('appts')}
          >
            <Text style={[styles.tabText, activeTab === 'appts' && styles.tabTextActive]}>Appts ({appointments.length})</Text>
          </TouchableOpacity>
        </View>

        {/* Tab Content */}
        <View style={styles.tabContent}>
          {activeTab === 'meds' && (
            <View>
              {medications.length === 0 && <Text style={styles.emptyText}>No active medications.</Text>}
              {medications.map((med) => (
                <View key={med.id} style={styles.medCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.medName}>{med.drug_name}</Text>
                    <Text style={styles.medDetails}>{med.dosage} • {med.frequency}</Text>
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
                  <Text style={styles.emptyText}>No history available.</Text>
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
              {mealPlanLoading ? (
                <View style={styles.emptyState}>
                  <MaterialCommunityIcons name="food-apple-outline" size={48} color="#CBD5E1" />
                  <Text style={styles.emptyText}>Loading diet plan...</Text>
                </View>
              ) : !mealPlan ? (
                <View style={styles.emptyState}>
                  <MaterialCommunityIcons name="food-off-outline" size={48} color="#CBD5E1" />
                  <Text style={styles.emptyText}>No diet plan generated yet.</Text>
                  <Text style={{ color: '#94A3B8', fontSize: 12, marginTop: 4 }}>Generate from the patient app.</Text>
                </View>
              ) : (
                <View>
                  {/* Clinical Notes */}
                  {mealPlan.clinicalNotes && (
                    <View style={{ backgroundColor: '#F0FDFA', borderRadius: 16, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: '#CCFBF1' }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#0F766E', marginBottom: 6 }}>📋 Clinical Notes</Text>
                      <Text style={{ fontSize: 12, color: '#334155', lineHeight: 18 }}>{mealPlan.clinicalNotes}</Text>
                    </View>
                  )}

                  {/* Nutrition Summary */}
                  {mealPlan.nutrition && (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                      {Object.entries(typeof mealPlan.nutrition === 'string' ? JSON.parse(mealPlan.nutrition || '{}') : mealPlan.nutrition).map(([k, v]) => (
                        <View key={k} style={{ backgroundColor: '#FFF7ED', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#FED7AA' }}>
                          <Text style={{ fontSize: 14, fontWeight: '800', color: '#C2410C' }}>{String(v)}</Text>
                          <Text style={{ fontSize: 10, fontWeight: '600', color: '#9A3412', textTransform: 'capitalize' }}>{k}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Days with meals */}
                  {mealPlan.days && (
                    Object.entries(typeof mealPlan.days === 'string' ? JSON.parse(mealPlan.days) : mealPlan.days).map(([day, dayData]) => {
                      const meals = dayData?.meals || (Array.isArray(dayData) ? dayData : []);
                      if (!meals.length) return null;
                      return (
                        <View key={day} style={{ marginBottom: 16 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 6 }}>
                            <View style={{ backgroundColor: '#0D9488', width: 28, height: 28, borderRadius: 8, justifyContent: 'center', alignItems: 'center' }}>
                              <Text style={{ color: '#FFF', fontSize: 10, fontWeight: '800' }}>{day.slice(0, 2).toUpperCase()}</Text>
                            </View>
                            <Text style={{ fontSize: 15, fontWeight: '800', color: '#134E4A' }}>{day}</Text>
                          </View>
                          {meals.map((meal, idx) => (
                            <View key={idx} style={{ backgroundColor: '#FFF', borderRadius: 14, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#E2E8F0', flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                              <View style={{ backgroundColor: meal.label === 'Breakfast' ? '#FEF3C7' : meal.label === 'Lunch' ? '#DBEAFE' : meal.label === 'Dinner' ? '#EDE9FE' : '#DCFCE7', width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' }}>
                                <Text style={{ fontSize: 16 }}>{meal.label === 'Breakfast' ? '🌅' : meal.label === 'Lunch' ? '☀️' : meal.label === 'Dinner' ? '🌙' : '🍎'}</Text>
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text style={{ fontSize: 13, fontWeight: '700', color: '#1E293B' }}>{meal.name || meal.meal || 'Meal'}</Text>
                                {meal.label && <Text style={{ fontSize: 10, fontWeight: '600', color: '#64748B', marginTop: 1 }}>{meal.label}</Text>}
                                {meal.description && <Text style={{ fontSize: 11, color: '#64748B', marginTop: 3, lineHeight: 16 }} numberOfLines={2}>{meal.description}</Text>}
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
                        <Text style={{ fontSize: 14, fontWeight: '700', color: '#134E4A', marginBottom: 6, textTransform: 'capitalize' }}>{mealType}</Text>
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
                  <Text style={styles.emptyText}>No appointments yet.</Text>
                </View>
              ) : (
                appointments.map((apt) => (
                  <View key={apt.appointment_id} style={{ backgroundColor: '#FFF', borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#E2E8F0', flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                    <View style={{ backgroundColor: '#ECFDF5', width: 44, height: 44, borderRadius: 14, justifyContent: 'center', alignItems: 'center' }}>
                      <MaterialCommunityIcons name="calendar-check" size={22} color="#10B981" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: '#1E293B' }}>Dr. {apt.doctor_name}</Text>
                      <Text style={{ fontSize: 11, color: '#64748B', marginTop: 1 }}>{apt.specialization}</Text>
                      <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
                        <Text style={{ fontSize: 11, color: '#0D9488', fontWeight: '600' }}>📅 {new Date(apt.appointment_date).toLocaleDateString()}</Text>
                        {apt.appointment_time && <Text style={{ fontSize: 11, color: '#0D9488', fontWeight: '600' }}>🕐 {apt.appointment_time}</Text>}
                      </View>
                      {apt.reason && <Text style={{ fontSize: 11, color: '#94A3B8', marginTop: 3 }}>{apt.reason}</Text>}
                    </View>
                    <View style={{ backgroundColor: apt.status === 'completed' ? '#DCFCE7' : apt.status === 'cancelled' ? '#FEE2E2' : '#DBEAFE', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
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
                <Text style={{ color: '#FFF', fontSize: 15, fontWeight: '700' }}>Book Appointment</Text>
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
                    <Text style={{ fontSize: 11, color: '#64748B', marginTop: 2 }} numberOfLines={2}>{residentDetails.emotionalStates[0].clinical_notes}</Text>
                  )}
                </View>
                <View style={{ alignItems: 'center' }}>
                  <MaterialCommunityIcons name="chevron-right" size={22} color="#94A3B8" />
                  <Text style={styles.viewLogText}>View Log</Text>
                </View>
              </View>
            </TouchableOpacity>
          ) : (
            <Text style={styles.emptyText}>No wellness logs recorded.</Text>
          )}
        </View>

      </ScrollView>

      {/* Appointment Booking Modal */}
      <Modal visible={showApptModal} animationType="slide" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, maxHeight: '90%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ fontSize: 20, fontWeight: '800', color: '#1E293B' }}>Book Appointment</Text>
              <TouchableOpacity onPress={() => { setShowApptModal(false); setSelectedDoctor(null); }} style={{ padding: 4 }}>
                <MaterialCommunityIcons name="close" size={24} color="#64748B" />
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
                        borderColor: selectedDoctor?.doctor_id === doc.doctor_id ? '#0D9488' : '#E2E8F0',
                        backgroundColor: selectedDoctor?.doctor_id === doc.doctor_id ? '#F0FDFA' : '#FFF',
                      }}
                    >
                      <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: selectedDoctor?.doctor_id === doc.doctor_id ? '#0D9488' : '#F1F5F9', justifyContent: 'center', alignItems: 'center' }}>
                        <Text style={{ fontSize: 18, fontWeight: '800', color: selectedDoctor?.doctor_id === doc.doctor_id ? '#FFF' : '#64748B' }}>{doc.name.charAt(0)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, fontWeight: '700', color: '#1E293B' }}>Dr. {doc.name}</Text>
                        <Text style={{ fontSize: 11, color: '#64748B' }}>{doc.specialization || 'General'}{doc.hospital ? ` • ${doc.hospital}` : ''}</Text>
                      </View>
                      {selectedDoctor?.doctor_id === doc.doctor_id && (
                        <MaterialCommunityIcons name="check-circle" size={22} color="#0D9488" />
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              ) : (
                <View style={{ alignItems: 'center', paddingVertical: 20, marginBottom: 12 }}>
                  <MaterialCommunityIcons name="doctor" size={36} color="#CBD5E1" />
                  <Text style={{ color: '#94A3B8', fontSize: 12, marginTop: 6 }}>No doctors registered. Ask admin to add doctors.</Text>
                </View>
              )}

              {/* Date & Time */}
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#475569', marginBottom: 8 }}>Appointment Details</Text>
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
                <TouchableOpacity onPress={() => setShowDatePicker(true)} style={{ flex: 1, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, padding: 14, backgroundColor: '#F8FAFC', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <MaterialCommunityIcons name="calendar" size={18} color="#0D9488" />
                  <Text style={{ fontSize: 14, color: apptForm.date ? '#1E293B' : '#9CA3AF' }}>{apptForm.date || 'Select Date *'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowTimePicker(true)} style={{ flex: 1, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, padding: 14, backgroundColor: '#F8FAFC', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <MaterialCommunityIcons name="clock-outline" size={18} color="#0D9488" />
                  <Text style={{ fontSize: 14, color: apptForm.time ? '#1E293B' : '#9CA3AF' }}>{apptForm.time || 'Select Time'}</Text>
                </TouchableOpacity>
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
              <TextInput placeholder="Reason for visit" value={apptForm.reason} onChangeText={t => setApptForm(p => ({...p, reason: t}))} multiline numberOfLines={2} style={{ borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, padding: 14, fontSize: 14, marginBottom: 16, backgroundColor: '#F8FAFC', textAlignVertical: 'top', minHeight: 60 }} />

              <TouchableOpacity onPress={handleBookAppointment} disabled={!selectedDoctor} style={{ backgroundColor: selectedDoctor ? '#10B981' : '#CBD5E1', borderRadius: 16, padding: 16, alignItems: 'center', shadowColor: '#10B981', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 }}>
                <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '800' }}>{selectedDoctor ? `Book with Dr. ${selectedDoctor.name}` : 'Select a Doctor'}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Wellness Log Modal */}
      <Modal visible={showWellnessLog} animationType="slide" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, maxHeight: '85%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ fontSize: 20, fontWeight: '800', color: '#1E293B' }}>Wellness History</Text>
              <TouchableOpacity onPress={() => setShowWellnessLog(false)} style={{ padding: 4 }}>
                <MaterialCommunityIcons name="close" size={24} color="#64748B" />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {(residentDetails?.emotionalStates || []).map((es, idx) => {
                const getEmoji = (label) => {
                  if (label === 'Happy') return { icon: 'emoticon-happy-outline', color: '#10B981', bg: '#ECFDF5' };
                  if (label === 'Sad') return { icon: 'emoticon-sad-outline', color: '#EF4444', bg: '#FEF2F2' };
                  if (label === 'Anxious') return { icon: 'emoticon-angry-outline', color: '#F59E0B', bg: '#FFFBEB' };
                  return { icon: 'emoticon-neutral-outline', color: '#6366F1', bg: '#EEF2FF' };
                };
                const emo = getEmoji(es.emotion_label);
                const score = es.state_score || es.wellness_score || 0;
                return (
                  <View key={idx} style={{ backgroundColor: '#FFF', borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#F1F5F9' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                      <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: emo.bg, justifyContent: 'center', alignItems: 'center' }}>
                        <MaterialCommunityIcons name={emo.icon} size={24} color={emo.color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 15, fontWeight: '700', color: '#1E293B' }}>Feeling {es.emotion_label || 'Unknown'}</Text>
                        <Text style={{ fontSize: 11, color: '#94A3B8' }}>{new Date(es.recorded_at).toLocaleString()}</Text>
                      </View>
                      <View style={{ backgroundColor: score >= 70 ? '#DCFCE7' : score >= 40 ? '#FEF3C7' : '#FEE2E2', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 }}>
                        <Text style={{ fontSize: 13, fontWeight: '800', color: score >= 70 ? '#166534' : score >= 40 ? '#92400E' : '#991B1B' }}>{score}</Text>
                      </View>
                    </View>
                    {es.clinical_notes && (
                      <View style={{ backgroundColor: '#F8FAFC', borderRadius: 10, padding: 10, marginTop: 4 }}>
                        <Text style={{ fontSize: 12, color: '#475569', lineHeight: 18 }}>{es.clinical_notes}</Text>
                      </View>
                    )}
                  </View>
                );
              })}
              {(!residentDetails?.emotionalStates || residentDetails.emotionalStates.length === 0) && (
                <View style={{ alignItems: 'center', paddingVertical: 32 }}>
                  <MaterialCommunityIcons name="emoticon-neutral-outline" size={48} color="#CBD5E1" />
                  <Text style={{ color: '#94A3B8', marginTop: 8 }}>No wellness records found.</Text>
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
  safeArea: { flex: 1, backgroundColor: '#F8FAFC' },
  header: { 
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', 
    paddingHorizontal: 20, paddingVertical: 16, backgroundColor: '#FFFFFF',
    borderBottomWidth: 1, borderBottomColor: '#E2E8F0'
  },
  backBtn: { padding: 8, backgroundColor: '#F0FDFA', borderRadius: 20 },
  headerTitleContainer: { alignItems: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#1E293B' },
  headerSubtitle: { fontSize: 13, color: '#64748B', fontWeight: '500' },

  scrollContainer: { padding: 16, paddingBottom: 40 },

  quickActionsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  actionBtn: { 
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', 
    paddingVertical: 12, borderRadius: 12, marginHorizontal: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 2
  },
  actionText: { color: '#FFF', fontWeight: '700', marginLeft: 8, fontSize: 15 },

  tabsContainer: { flexDirection: 'row', backgroundColor: '#FFFFFF', borderRadius: 12, padding: 4, marginBottom: 16, borderWidth: 1, borderColor: '#E2E8F0' },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  tabActive: { backgroundColor: '#F0FDFA' },
  tabText: { fontSize: 14, fontWeight: '600', color: '#64748B' },
  tabTextActive: { color: '#0D9488' },

  tabContent: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, marginBottom: 24, borderWidth: 1, borderColor: '#E2E8F0' },
  
  medCard: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  medName: { fontSize: 16, fontWeight: '700', color: '#1E293B', marginBottom: 2 },
  medDetails: { fontSize: 13, color: '#64748B' },
  
  finishBtn: { 
    borderWidth: 1, borderColor: '#10B981', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
    backgroundColor: '#ECFDF5'
  },
  finishBtnDone: { backgroundColor: '#F1F5F9', borderColor: '#E2E8F0' },
  finishText: { color: '#059669', fontSize: 12, fontWeight: '700' },
  finishTextDone: { color: '#94A3B8' },

  emptyState: { alignItems: 'center', paddingVertical: 32 },
  emptyText: { color: '#94A3B8', marginTop: 8, fontWeight: '500' },

  wellnessSection: { marginTop: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1E293B', marginBottom: 12, marginLeft: 4 },
  wellnessCard: { 
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', padding: 16, borderRadius: 16,
    borderWidth: 1, borderColor: '#E2E8F0'
  },
  emotionIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#ECFDF5', justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  wellnessStatus: { fontSize: 16, fontWeight: '700', color: '#1E293B', marginBottom: 2 },
  wellnessTime: { fontSize: 13, color: '#64748B' },
  viewLogBtn: { padding: 8 },
  viewLogText: { color: '#3B82F6', fontWeight: '700', fontSize: 13 }
});

export default PatientProfileScreen;
