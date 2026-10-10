import { localDateKey, calendarDateKey, parseCalendarDate, upcomingAppointments, appointmentInstant } from '../calendar';
import RequestError from '../components/RequestError';
import { useScreenRefresh } from '../useScreenRefresh';
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { apiFetch, getResidentId } from '../apiHelper';
import AppointmentEditor from '../components/AppointmentEditor';

const AppointmentsScreen = ({ navigation }) => {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editing,setEditing] = useState(undefined);
  const [cancelling,setCancelling] = useState(null);
  const cancelLock = React.useRef(false);
  const cancelAppointment = async appointment => {
    if(cancelLock.current)return;cancelLock.current=true;setCancelling(appointment.appointment_id);
    try{const response=await apiFetch('/appointments/'+encodeURIComponent(appointment.appointment_id),{method:'PUT',body:JSON.stringify({status:'cancelled'})});const data=await response.json();if(!response.ok)throw Error(data.error||'Cancellation could not be saved.');await fetchAppointments();}
    catch(error){Alert.alert('Could not cancel',error.message);}finally{cancelLock.current=false;setCancelling(null);}
  };

  const fetchAppointments = useCallback(async () => {
    try {
      setLoadError(null);
      const residentId = await getResidentId();
      const res = await apiFetch(`/residents/${residentId}/appointments`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      // Sort by date ascending (upcoming first)
      data.sort((a, b) => appointmentInstant(a) - appointmentInstant(b));
      setAppointments(data);
    } catch (err) {
      setLoadError('We could not load your care records. Check your connection and try again.');
      console.error('[Appointments] Fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useScreenRefresh(navigation, fetchAppointments);

  // Find next upcoming appointment
  const today = localDateKey();
  const upcoming = upcomingAppointments(appointments);
  const nextApt = upcoming[0];

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const d = parseCalendarDate(dateStr);
    if (!d) return 'Date unavailable';
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  };

  const getDaysUntil = (dateStr) => {
    if (!dateStr) return '';
    const target = parseCalendarDate(dateStr);
    if (!target) return 'Date unavailable';
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const diff = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff < 0) return `${Math.abs(diff)} days ago`;
    return `in ${diff} days`;
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}><ActivityIndicator size="large" color="#F59E0B" /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#171459" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Appointments</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAppointments(); }} colors={["#6D38FF"]} />}
      >
        <RequestError message={loadError} onRetry={fetchAppointments} />
        <TouchableOpacity onPress={()=>setEditing(null)} style={{padding:16,borderRadius:12,backgroundColor:'#6D38FF',marginBottom:16}}><Text style={{color:'white',fontWeight:'700',textAlign:'center'}}>Book new appointment</Text></TouchableOpacity>
        {/* Banner */}
        <View style={styles.bannerCard}>
          <View pointerEvents="none" style={styles.heroOrb} />
          <View pointerEvents="none" style={styles.heroOrbSmall} />
          <View style={styles.bannerContent}>
            <View style={styles.heroCopy}>
              <Text style={styles.heroEyebrow}>CARE, ON YOUR CALENDAR</Text>
              <Text style={styles.bannerTitle}>{loadError ? 'Appointments unavailable' : nextApt ? 'Next Appointment' : 'No Upcoming'}</Text>
              <Text style={styles.bannerSubtitle}>
                {nextApt ? getDaysUntil(nextApt.appointment_date) : 'Book a visit or ask your caretaker'}
              </Text>
            </View>
            {nextApt && (
              <View style={styles.dateCircle}>
                <Text style={styles.dateNum}>{parseCalendarDate(nextApt.appointment_date).getDate()}</Text>
                <Text style={styles.dateMonth}>{parseCalendarDate(nextApt.appointment_date).toLocaleString('en', { month: 'short' }).toUpperCase()}</Text>
              </View>
            )}
          </View>
        </View>

        <Text style={styles.sectionTitle}>
          {upcoming.length > 0 ? 'Upcoming Visits' : 'All Appointments'}
        </Text>

        {!loadError && appointments.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="calendar-blank" size={48} color="#A2A4C3" />
            <Text style={styles.emptyTitle}>No Appointments</Text>
            <Text style={styles.emptySubtitle}>Book a new appointment or ask your caretaker for help.</Text>
          </View>
        ) : (
          <View style={styles.listContainer}>
            {appointments.map((apt) => {
              const isCancelled = apt.status === 'cancelled';
              const isPast = calendarDateKey(apt.appointment_date) < today;
              const isToday = apt.appointment_date && calendarDateKey(apt.appointment_date) === today;
              return (
                <View key={apt.appointment_id} style={[styles.aptCard, isCancelled && styles.aptCardCancelled, isToday && !isCancelled && { borderColor: '#FCA5A5', borderWidth: 2, backgroundColor: '#FFF5F5' }]}>
                  <View style={styles.aptHeader}>
                    <View style={[styles.dateTimeBadge, isToday && !isCancelled && { backgroundColor: '#FEE2E2' }]}>
                      <MaterialCommunityIcons name={isToday ? 'calendar-alert' : 'calendar-clock'} size={16} color={isToday && !isCancelled ? '#DC2626' : '#B45309'} style={{ marginRight: 6 }} />
                      <Text style={[styles.dateTimeText, isToday && !isCancelled && { color: '#991B1B' }]}>
                        {formatDate(apt.appointment_date)}{apt.appointment_time ? ` at ${apt.appointment_time}` : ''}
                      </Text>
                    </View>
                    {isCancelled ? (
                      <View style={[styles.typeBadge, { backgroundColor: '#FEE2E2' }]}>
                        <Text style={{ fontSize: 10, fontWeight: '700', color: '#DC2626' }}>CANCELLED</Text>
                      </View>
                    ) : isToday ? (
                      <View style={[styles.typeBadge, { backgroundColor: '#EF4444' }]}>
                        <Text style={{ fontSize: 10, fontWeight: '800', color: '#FFFFFF' }}>TODAY</Text>
                      </View>
                    ) : (
                      <View style={[styles.typeBadge, { backgroundColor: isPast ? '#EDF2EE' : '#DCFCE7' }]}>
                        <Text style={{ fontSize: 10, fontWeight: '700', color: isPast ? '#62756C' : '#16A34A' }}>
                          {isPast ? 'PAST' : 'UPCOMING'}
                        </Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.aptBody}>
                    <View style={styles.docAvatar}>
                      <Text style={styles.avatarText}>
                        {(apt.doctor_name || 'D').replace('Dr. ', '').charAt(0)}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.docName, isCancelled && { textDecorationLine: 'line-through', color: '#788C82' }]}>
                        {apt.doctor_name || 'Doctor'}
                      </Text>
                      <Text style={styles.docSpec}>{apt.specialization || 'General'}</Text>
                    </View>
                  </View>

                  <View style={styles.aptFooter}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                      <MaterialCommunityIcons name="text-box-outline" size={16} color="#8287A7" style={{ marginRight: 6 }} />
                      <Text style={styles.reasonText}>{apt.reason || 'General Checkup'}</Text>
                    </View>
                  </View>
                  {['scheduled','rescheduled'].includes(apt.status)&&!isPast?<View style={{flexDirection:'row',gap:16}}><TouchableOpacity disabled={cancelling!=null} onPress={()=>setEditing(apt)}><Text style={{paddingVertical:12,color:'#6D38FF'}}>Reschedule</Text></TouchableOpacity><TouchableOpacity disabled={cancelling!=null} onPress={()=>Alert.alert('Cancel appointment?','This will cancel the visit with '+apt.doctor_name+'.',[{text:'Keep visit',style:'cancel'},{text:'Cancel visit',style:'destructive',onPress:()=>void cancelAppointment(apt)}])}><Text style={{paddingVertical:12,color:'#991B1B'}}>{cancelling===apt.appointment_id?'Saving…':'Cancel visit'}</Text></TouchableOpacity></View>:null}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
      {editing!==undefined?<AppointmentEditor appointment={editing} onClose={()=>setEditing(undefined)} onSaved={fetchAppointments}/>:null}
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
  scrollContainer: {
    padding: 20,
    paddingBottom: 44
  },
  bannerCard: {
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
    minHeight: 178,
    borderWidth: 0,
    overflow: "hidden"
  },
  bannerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  bannerTitle: {
    fontSize: 29,
    fontWeight: "800",
    color: "#FFFFFF",
    marginBottom: 9,
    lineHeight: 34,
    letterSpacing: -1
  },
  bannerSubtitle: {
    fontSize: 14,
    color: "#DAD9FF",
    fontWeight: "500",
    lineHeight: 22
  },
  dateCircle: {
    width: 76,
    height: 84,
    borderRadius: 24,
    backgroundColor: "#EEE9FF",
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10
  },
  dateNum: {
    color: "#171459",
    fontWeight: '800',
    fontSize: 29,
    lineHeight: 33,
    letterSpacing: -0.8
  },
  dateMonth: {
    color: "#5355B7",
    fontWeight: '700',
    fontSize: 11,
    letterSpacing: 1.4,
    marginTop: 2
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
    textAlign: "center",
    lineHeight: 23
  },
  listContainer: {
    gap: 16
  },
  aptCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    padding: 18,
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
  aptCardCancelled: {
    opacity: 0.6
  },
  aptHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: "flex-start",
    marginBottom: 16,
    paddingBottom: 13,
    borderBottomWidth: 1,
    borderBottomColor: "#EEE9FF",
    flexWrap: "wrap",
    gap: 8
  },
  dateTimeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: "#EEE9FF",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 13,
    flexShrink: 1
  },
  dateTimeText: {
    fontSize: 12,
    fontWeight: '700',
    color: "#424581",
    lineHeight: 18,
    flexShrink: 1
  },
  typeBadge: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 10
  },
  aptBody: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16
  },
  docAvatar: {
    width: 58,
    height: 58,
    borderRadius: 20,
    backgroundColor: "#EEE9FF",
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 13
  },
  avatarText: {
    fontSize: 24,
    fontWeight: "800",
    color: "#5355B7"
  },
  docName: {
    fontSize: 20,
    fontWeight: "800",
    color: "#171459",
    marginBottom: 2,
    lineHeight: 26,
    letterSpacing: -0.5
  },
  docSpec: {
    fontSize: 13,
    color: "#6B6F91",
    lineHeight: 20
  },
  aptFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: "#F6F5FF",
    padding: 13,
    borderRadius: 17
  },
  reasonText: {
    fontSize: 13,
    color: "#626786",
    fontWeight: '500',
    lineHeight: 20,
    flexShrink: 1
  },
  closeBtn: {
    width: 46,
    height: 46,
    borderRadius: 17,
    backgroundColor: "#EEE9FF"
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

export default AppointmentsScreen;

