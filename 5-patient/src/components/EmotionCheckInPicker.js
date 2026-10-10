import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getEmotionCheckInCopy, getEmotionCheckInState, searchEmotionCheckInStates } from '../../../shared/emotionCheckInCatalog.js';

// This picker accepts the patient's answer. It never receives camera scores.
export default function EmotionCheckInPicker({ language = 'en', value, onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const copy = getEmotionCheckInCopy(language);
  const selected = getEmotionCheckInState(value, language);
  const states = useMemo(() => searchEmotionCheckInStates(query, language), [query, language]);
  const common = ['happy', 'sad', 'angry', 'anxious', 'neutral', 'pain', 'tired'];
  const choose = id => {
    if (disabled || !getEmotionCheckInState(id, language)) return;
    onChange(id);
    setOpen(false);
    setQuery('');
  };
  return <View>
    <Text style={styles.notice}>{copy.description}</Text>
    <View style={styles.common}>{common.map(id => {
      const state = getEmotionCheckInState(id, language);
      return <TouchableOpacity key={id} accessibilityRole="button" accessibilityState={{ selected: value === id, disabled }} disabled={disabled}
        onPress={() => choose(id)} style={[styles.chip, value === id && styles.active]}>
        <Text style={[styles.chipText, value === id && styles.activeText]}>{state.emoji} {state.label}</Text>
      </TouchableOpacity>;
    })}</View>
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} style={[styles.browse, disabled && styles.disabled]}
      onPress={() => { if (disabled) return; setQuery(''); setOpen(true); }}>
      <MaterialCommunityIcons name="text-search" size={22} color="#5C38BA" />
      <Text style={styles.browseText}>{copy.allStates}</Text>
      <MaterialCommunityIcons name="chevron-right" size={22} color="#5C38BA" />
    </TouchableOpacity>
    {selected && <View style={styles.selection}><Text style={styles.selectedText}>{selected.emoji} {selected.label}</Text><Text style={styles.source}>{copy.reportSource}</Text></View>}
    <Modal visible={open && !disabled} animationType="slide" onRequestClose={() => setOpen(false)}>
      <SafeAreaView style={styles.modal}>
        <View style={styles.heading}><Text style={styles.title}>{copy.title}</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel={copy.close}
          onPress={() => setOpen(false)} style={styles.close}><MaterialCommunityIcons name="close" size={26} color="#223B3A" /></TouchableOpacity></View>
        <Text style={styles.notice}>{copy.description}</Text>
        <View style={styles.search}><MaterialCommunityIcons name="magnify" size={22} color="#617878" /><TextInput value={query} onChangeText={setQuery}
          accessibilityLabel={copy.searchPlaceholder} placeholder={copy.searchPlaceholder} placeholderTextColor="#617878" style={styles.input} autoCorrect={false} maxLength={100} /></View>
        <Text style={styles.count}>{states.length} · {copy.statesCountLabel}</Text>
        <FlatList data={states} keyExtractor={state => state.id} keyboardShouldPersistTaps="handled" initialNumToRender={12} maxToRenderPerBatch={12}
          contentContainerStyle={styles.list} ListEmptyComponent={<Text style={styles.notice}>{copy.noResults}</Text>}
          renderItem={({ item }) => <TouchableOpacity accessibilityRole="button" accessibilityState={{ selected: value === item.id }}
            onPress={() => choose(item.id)} style={[styles.row, value === item.id && styles.selectedRow]}>
            <Text style={styles.emoji}>{item.emoji}</Text><View style={styles.rowBody}><Text style={styles.label}>{item.label}</Text><Text style={styles.category}>{copy.categories[item.category]}</Text></View>
            {value === item.id && <MaterialCommunityIcons name="check-circle" color="#237C69" size={24} />}
          </TouchableOpacity>} />
      </SafeAreaView>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  notice: { color: '#5B6875', fontSize: 13, lineHeight: 20, marginBottom: 12 }, common: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 11, borderRadius: 13, backgroundColor: '#F0EDF9', borderWidth: 1, borderColor: '#DDD5F2' },
  active: { backgroundColor: '#5C38BA', borderColor: '#5C38BA' }, chipText: { color: '#3E3660', fontWeight: '600' }, activeText: { color: '#FFF' },
  browse: { marginTop: 12, padding: 15, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#F3EFFC' },
  browseText: { flex: 1, color: '#5C38BA', fontWeight: '700', fontSize: 15 }, disabled: { opacity: 0.5 },
  selection: { padding: 14, marginTop: 12, borderRadius: 14, backgroundColor: '#EAF6F1' }, selectedText: { fontSize: 18, color: '#215D50', fontWeight: '700' },
  source: { marginTop: 5, color: '#4C7065', fontSize: 12, lineHeight: 18 }, modal: { flex: 1, backgroundColor: '#F7FAF9', padding: 20 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }, title: { flex: 1, color: '#183C36', fontWeight: '800', fontSize: 22 },
  close: { padding: 10, backgroundColor: '#E7EFEC', borderRadius: 14 }, search: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 14, backgroundColor: '#EAF0EE', borderRadius: 14 },
  input: { flex: 1, paddingVertical: 14, color: '#193D35', fontSize: 15 }, count: { marginVertical: 12, fontSize: 12, color: '#617878' },
  list: { paddingBottom: 30, gap: 8 }, row: { padding: 15, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E1E9E6', borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
  selectedRow: { backgroundColor: '#ECF7F1', borderColor: '#7ABDAB' }, emoji: { fontSize: 27 }, rowBody: { flex: 1 }, label: { fontSize: 17, fontWeight: '600', color: '#203D38' },
  category: { fontSize: 12, color: '#658077', marginTop: 4 },
});
