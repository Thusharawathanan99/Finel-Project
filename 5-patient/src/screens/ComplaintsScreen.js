import RequestError from '../components/RequestError';
import { useScreenRefresh } from '../useScreenRefresh';
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Modal, TextInput, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { apiFetch, getResidentId } from '../apiHelper';
import { auth } from '../firebase/config';

const ComplaintsScreen = ({ navigation }) => {
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  const fetchComplaints = useCallback(async () => {
    try {
      setLoadError(null);
      const residentId = await getResidentId();
      const res = await apiFetch(`/residents/${residentId}/complaints`);
      if (!res.ok) throw new Error('Complaints unavailable');
      if (res.ok) {
        const data = await res.json();
        setComplaints(data);
      }
    } catch (err) {
      setLoadError('We could not load your care records. Check your connection and try again.');
      console.error('[Complaints] Fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useScreenRefresh(navigation, fetchComplaints);

  const handleSubmit = async () => {
    if (!subject.trim() || !message.trim()) {
      Alert.alert('Required', 'Please enter a subject and message.');
      return;
    }
    setSubmitting(true);
    try {
      const residentId = await getResidentId();
      const user = auth.currentUser;
      const res = await apiFetch('/complaints', {
        method: 'POST',
        body: JSON.stringify({
          residentId,
          residentName: user?.displayName || 'Patient',
          subject: subject.trim(),
          message: message.trim(),
        }),
      });
      if (!res.ok) throw new Error('Failed to submit');
      Alert.alert('Submitted ✓', 'Your complaint has been sent to the admin.');
      setShowModal(false);
      setSubject('');
      setMessage('');
      fetchComplaints();
    } catch (err) {
      console.error('[Complaints] Submit error:', err);
      Alert.alert('Error', 'Could not submit complaint. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusStyle = (status) => {
    switch (status) {
      case 'resolved': return { bg: '#DCFCE7', color: '#166534', icon: 'check-circle', label: 'RESOLVED' };
      case 'reviewed': return { bg: '#D8EEE6', color: '#1E40AF', icon: 'eye-check', label: 'REVIEWED' };
      default: return { bg: '#FEF3C7', color: '#92400E', icon: 'clock-outline', label: 'PENDING' };
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}><ActivityIndicator size="large" color="#EF4444" /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#171459" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Complaints</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowModal(true)}>
          <MaterialCommunityIcons name="plus" size={24} color="#EF4444" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchComplaints(); }} colors={["#6D38FF"]} />}
      >
        <RequestError message={loadError} onRetry={fetchComplaints} />
        {/* Banner */}
        <View style={styles.bannerCard}>
          <View pointerEvents="none" style={styles.heroOrb} />
          <View pointerEvents="none" style={styles.heroOrbSmall} />
          <View style={styles.heroCopy}>
            <Text style={styles.heroEyebrow}>WE ARE HERE TO LISTEN</Text>
            <Text style={styles.bannerTitle}>Report an Issue</Text>
            <Text style={styles.bannerSubtitle}>Send complaints directly to admin</Text>
          </View>
          <MaterialCommunityIcons name="message-alert" size={38} color="#FFB85C" opacity={1} />
        </View>

        {!loadError && complaints.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="message-text-outline" size={48} color="#A2A4C3" />
            <Text style={styles.emptyTitle}>No Complaints</Text>
            <Text style={styles.emptySubtitle}>You haven't submitted any complaints yet.</Text>
          </View>
        ) : (
          <View style={styles.listContainer}>
            {complaints.map((c) => {
              const statusInfo = getStatusStyle(c.status);
              return (
                <View key={c.id} style={styles.complaintCard}>
                  <View style={styles.cardHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardSubject}>{c.subject}</Text>
                      <Text style={styles.cardDate}>
                        {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </Text>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: statusInfo.bg }]}>
                      <MaterialCommunityIcons name={statusInfo.icon} size={12} color={statusInfo.color} style={{ marginRight: 4 }} />
                      <Text style={{ fontSize: 10, fontWeight: '700', color: statusInfo.color }}>{statusInfo.label}</Text>
                    </View>
                  </View>

                  <Text style={styles.cardMessage} numberOfLines={3}>{c.message}</Text>

                  {c.admin_response && (
                    <View style={styles.responseBox}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <MaterialCommunityIcons name="shield-check" size={14} color="#5355B7" />
                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#7C3AED' }}>Admin Response</Text>
                      </View>
                      <Text style={styles.responseText}>{c.admin_response}</Text>
                      {c.responded_by && (
                        <Text style={styles.respondedBy}>— {c.responded_by}</Text>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* Submit Button */}
        <TouchableOpacity style={styles.submitBtn} onPress={() => setShowModal(true)}>
          <MaterialCommunityIcons name="message-plus" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
          <Text style={styles.submitBtnText}>New Complaint</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Submit Complaint Modal */}
      <Modal visible={showModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Submit Complaint</Text>
              <TouchableOpacity onPress={() => { setShowModal(false); setSubject(''); setMessage(''); }}>
                <MaterialCommunityIcons name="close" size={24} color="#6B6F91" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.inputLabel}>Subject *</Text>
              <TextInput
                style={styles.input}
                placeholder="Brief title for your complaint"
                value={subject}
                onChangeText={setSubject}
                placeholderTextColor="#8287A7"
              />

              <Text style={styles.inputLabel}>Message *</Text>
              <TextInput
                style={[styles.input, { minHeight: 120, textAlignVertical: 'top' }]}
                placeholder="Describe your complaint in detail..."
                value={message}
                onChangeText={setMessage}
                multiline
                numberOfLines={5}
                placeholderTextColor="#8287A7"
              />

              <TouchableOpacity
                style={[styles.confirmBtn, submitting && { opacity: 0.6 }]}
                onPress={handleSubmit}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <MaterialCommunityIcons name="send" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
                    <Text style={styles.confirmBtnText}>Submit Complaint</Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  addBtn: {
    padding: 8,
    backgroundColor: "#FFE6E1",
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
  bannerCard: {
    backgroundColor: "#171459",
    borderRadius: 32,
    padding: 24,
    marginBottom: 26,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: "#171459",
    shadowOffset: {
      width: 0,
      height: 8
    },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 5,
    borderWidth: 0,
    borderColor: "#E4E3F4",
    minHeight: 178,
    overflow: "hidden"
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
    lineHeight: 23,
    textAlign: "center"
  },
  listContainer: {
    gap: 16
  },
  complaintCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    padding: 20,
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
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
    flexWrap: "wrap",
    gap: 10
  },
  cardSubject: {
    fontSize: 20,
    fontWeight: "800",
    color: "#171459",
    marginBottom: 6,
    lineHeight: 26,
    letterSpacing: -0.5
  },
  cardDate: {
    fontSize: 12,
    color: "#8287A7",
    fontWeight: '500',
    lineHeight: 18
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 11
  },
  cardMessage: {
    fontSize: 14,
    color: "#626786",
    lineHeight: 23,
    marginBottom: 8
  },
  responseBox: {
    backgroundColor: "#EEE9FF",
    borderRadius: 20,
    padding: 15,
    marginTop: 7,
    borderWidth: 0,
    borderColor: "#DDDDF5"
  },
  responseText: {
    fontSize: 13,
    color: "#424581",
    lineHeight: 21
  },
  respondedBy: {
    fontSize: 11,
    color: "#5355B7",
    fontWeight: '600',
    marginTop: 6,
    fontStyle: 'italic',
    lineHeight: 18
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: "#171459",
    paddingVertical: 16,
    borderRadius: 20,
    marginTop: 32,
    shadowColor: "#171459",
    shadowOffset: {
      width: 0,
      height: 4
    },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
    minHeight: 56
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700'
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(37,40,91,0.55)",
    justifyContent: 'flex-end'
  },
  modalContent: {
    backgroundColor: "#F6F5FF",
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    padding: 26,
    maxHeight: '85%'
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24
  },
  modalTitle: {
    fontSize: 25,
    fontWeight: '800',
    color: "#171459",
    lineHeight: 31,
    letterSpacing: -0.8
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#171459",
    marginBottom: 8,
    marginTop: 12
  },
  input: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E4E3F4",
    borderRadius: 19,
    padding: 16,
    fontSize: 15,
    color: "#171459",
    minHeight: 54,
    lineHeight: 23
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: "#171459",
    paddingVertical: 16,
    borderRadius: 20,
    marginTop: 24,
    marginBottom: 16,
    minHeight: 56
  },
  confirmBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700'
  },
  closeBtn: {
    width: 46,
    height: 46,
    borderRadius: 17,
    backgroundColor: "#EEE9FF"
  },
  sectionTitle: {
    fontSize: 22,
    lineHeight: 29,
    fontWeight: "800",
    letterSpacing: -0.6,
    marginBottom: 16
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
  }
});

export default ComplaintsScreen;
