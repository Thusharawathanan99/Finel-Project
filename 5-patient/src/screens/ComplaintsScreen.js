import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Modal, TextInput, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { apiFetch, getResidentId } from '../apiHelper';
import { auth } from '../firebase/config';

const ComplaintsScreen = ({ navigation }) => {
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  const fetchComplaints = useCallback(async () => {
    try {
      const residentId = await getResidentId();
      const res = await apiFetch(`/residents/${residentId}/complaints`);
      if (res.ok) {
        const data = await res.json();
        setComplaints(data);
      }
    } catch (err) {
      console.error('[Complaints] Fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchComplaints(); }, [fetchComplaints]);

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
      case 'reviewed': return { bg: '#DBEAFE', color: '#1E40AF', icon: 'eye-check', label: 'REVIEWED' };
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
          <MaterialCommunityIcons name="arrow-left" size={24} color="#1E293B" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Complaints</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowModal(true)}>
          <MaterialCommunityIcons name="plus" size={24} color="#EF4444" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchComplaints(); }} colors={['#EF4444']} />}
      >
        {/* Banner */}
        <View style={styles.bannerCard}>
          <View>
            <Text style={styles.bannerTitle}>Report an Issue</Text>
            <Text style={styles.bannerSubtitle}>Send complaints directly to admin</Text>
          </View>
          <MaterialCommunityIcons name="message-alert" size={32} color="#FFFFFF" opacity={0.8} />
        </View>

        {complaints.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="message-text-outline" size={48} color="#CBD5E1" />
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
                        <MaterialCommunityIcons name="shield-check" size={14} color="#7C3AED" />
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
                <MaterialCommunityIcons name="close" size={24} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.inputLabel}>Subject *</Text>
              <TextInput
                style={styles.input}
                placeholder="Brief title for your complaint"
                value={subject}
                onChangeText={setSubject}
                placeholderTextColor="#9CA3AF"
              />

              <Text style={styles.inputLabel}>Message *</Text>
              <TextInput
                style={[styles.input, { minHeight: 120, textAlignVertical: 'top' }]}
                placeholder="Describe your complaint in detail..."
                value={message}
                onChangeText={setMessage}
                multiline
                numberOfLines={5}
                placeholderTextColor="#9CA3AF"
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
  safeArea: { flex: 1, backgroundColor: '#F8FAFC' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16, backgroundColor: '#FFFFFF',
    borderBottomWidth: 1, borderBottomColor: '#F1F5F9'
  },
  backBtn: { padding: 8, backgroundColor: '#F1F5F9', borderRadius: 20 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#1E293B' },
  addBtn: { padding: 8, backgroundColor: '#FEE2E2', borderRadius: 20 },

  scrollContainer: { padding: 24, paddingBottom: 40 },

  bannerCard: {
    backgroundColor: '#EF4444', borderRadius: 24, padding: 24, marginBottom: 32,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    shadowColor: '#EF4444', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 8
  },
  bannerTitle: { fontSize: 18, fontWeight: '700', color: '#FFFFFF', marginBottom: 4 },
  bannerSubtitle: { fontSize: 14, color: '#FECACA', fontWeight: '500' },

  emptyState: { alignItems: 'center', paddingVertical: 40 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#64748B', marginTop: 16, marginBottom: 4 },
  emptySubtitle: { fontSize: 14, color: '#94A3B8' },

  listContainer: { gap: 16 },
  complaintCard: {
    backgroundColor: '#FFFFFF', borderRadius: 20, padding: 16, borderWidth: 1, borderColor: '#F1F5F9',
    shadowColor: '#64748B', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  cardSubject: { fontSize: 16, fontWeight: '700', color: '#1E293B', marginBottom: 2 },
  cardDate: { fontSize: 12, color: '#94A3B8', fontWeight: '500' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  cardMessage: { fontSize: 14, color: '#475569', lineHeight: 20, marginBottom: 8 },

  responseBox: {
    backgroundColor: '#F5F3FF', borderRadius: 12, padding: 12, marginTop: 4,
    borderWidth: 1, borderColor: '#EDE9FE',
  },
  responseText: { fontSize: 13, color: '#4C1D95', lineHeight: 18 },
  respondedBy: { fontSize: 11, color: '#7C3AED', fontWeight: '600', marginTop: 6, fontStyle: 'italic' },

  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#EF4444', paddingVertical: 16, borderRadius: 16, marginTop: 32,
    shadowColor: '#EF4444', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 4
  },
  submitBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#FFFFFF', borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, maxHeight: '85%',
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  modalTitle: { fontSize: 22, fontWeight: '800', color: '#1E293B' },

  inputLabel: { fontSize: 14, fontWeight: '600', color: '#475569', marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12,
    padding: 14, fontSize: 15, color: '#1E293B',
  },
  confirmBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#EF4444', paddingVertical: 16, borderRadius: 16, marginTop: 24, marginBottom: 16,
  },
  confirmBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});

export default ComplaintsScreen;
