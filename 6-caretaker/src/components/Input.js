import React, { useState } from 'react';
import { TextInput, StyleSheet, View, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const Input = ({ placeholder, value, onChangeText, secureTextEntry, style }) => {
  const [passwordVisible, setPasswordVisible] = useState(false);
  return (
    <View style={styles.wrapper}>
      <TextInput accessibilityLabel={placeholder}
        style={[styles.input, style, secureTextEntry && styles.passwordInput]}
        placeholder={placeholder}
        placeholderTextColor="#9496AA"
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={Boolean(secureTextEntry) && !passwordVisible}
        autoCapitalize="none"
      />
      {secureTextEntry && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'}
          accessibilityState={{ expanded: passwordVisible }}
          style={styles.visibilityButton}
          onPress={() => setPasswordVisible((visible) => !visible)}
        >
          <MaterialCommunityIcons name={passwordVisible ? 'eye-off-outline' : 'eye-outline'} size={21} color="#615C87" />
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    width: '100%'
  },
  input: {
    minHeight: 55, borderWidth: 1, borderColor: '#E6E1FB', padding: 16, borderRadius: 17, marginTop: 9, marginBottom: 18, backgroundColor: '#F6F5FF', fontSize: 14, color: '#171459',
  },
  passwordInput: {
    paddingRight: 52
  },
  visibilityButton: {
    position: 'absolute',
    right: 10,
    top: 15,
    minWidth: 42,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center'
  },
});

export default Input;
