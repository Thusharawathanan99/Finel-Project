import React, { useState } from 'react';
import { TextInput, StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const Input = ({ label, placeholder, value, onChangeText, secureTextEntry, style }) => {
  const [passwordVisible, setPasswordVisible] = useState(false);
  return (
    <View style={[styles.container, style]}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={styles.inputWrapper}>
        <TextInput accessibilityLabel={label || placeholder}
          style={[styles.input, secureTextEntry && styles.passwordInput]}
          placeholder={placeholder}
          placeholderTextColor="#9292AC"
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
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 9,
    width: '100%'
  },
  label: {
    fontSize: 12,
    color: "#615C87",
    marginBottom: 8,
    fontWeight: "700"
  },
  inputWrapper: {
    position: 'relative',
    width: '100%'
  },
  input: {
    minHeight: 54,
    borderWidth: 1,
    borderColor: "#E4DFFF",
    paddingHorizontal: 17,
    paddingVertical: 15,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    fontSize: 15,
    color: "#171459",
    width: '100%'
  },
  passwordInput: {
    paddingRight: 50
  },
  visibilityButton: {
    position: 'absolute',
    right: 10,
    top: 7,
    minWidth: 42,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center'
  }
});

export default Input;
