import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { getAuth, updateProfile } from 'firebase/auth';

const C = {
  primary:    '#006633',
  light:      '#E6F4EC',
  white:      '#FFFFFF',
  bg:         '#F5F7FA',
  text:       '#1F2937',
  sub:        '#6B7280',
  border:     '#E5E7EB',
  success:    '#10B981',
  error:      '#EF4444',
};

function Field({
  label, value, editable, onChangeText, placeholder, keyboardType, icon,
}: {
  label: string;
  value: string;
  editable: boolean;
  onChangeText?: (t: string) => void;
  placeholder?: string;
  keyboardType?: any;
  icon: string;
}) {
  return (
    <View style={s.field}>
      <View style={s.fieldIcon}>
        <Ionicons name={icon as any} size={18} color={C.primary} />
      </View>
      <View style={s.fieldBody}>
        <Text style={s.fieldLabel}>{label}</Text>
        {editable ? (
          <TextInput
            style={s.fieldInput}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder ?? label}
            placeholderTextColor={C.sub}
            keyboardType={keyboardType}
            autoCapitalize="none"
          />
        ) : (
          <Text style={[s.fieldValue, !value && { color: C.sub }]}>
            {value || 'Not set'}
          </Text>
        )}
      </View>
    </View>
  );
}

export default function PersonalInformationScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const firebaseUser = getAuth().currentUser;

  const [editing,  setEditing]  = useState(false);
  const [fullName, setFullName] = useState(user?.displayName ?? firebaseUser?.displayName ?? '');
  const [phone,    setPhone]    = useState(firebaseUser?.phoneNumber ?? '');
  const [saving,   setSaving]   = useState(false);

  const email    = user?.email ?? firebaseUser?.email ?? '';
  const uid      = firebaseUser?.uid ?? '';
  const joined   = firebaseUser?.metadata?.creationTime
    ? new Date(firebaseUser.metadata.creationTime).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    : '—';

  const handleSave = async () => {
    if (!fullName.trim()) {
      Alert.alert('Error', 'Full name is required');
      return;
    }
    setSaving(true);
    try {
      if (firebaseUser) {
        await updateProfile(firebaseUser, { displayName: fullName.trim() });
      }
      setEditing(false);
      Alert.alert('Saved', 'Your profile has been updated.');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not save changes');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={s.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll}>

        <View style={s.avatarRow}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>
              {(fullName || email || 'U').charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={s.avatarName}>{fullName || email}</Text>
          <Text style={s.avatarSub}>Member since {joined}</Text>
        </View>

        <View style={s.card}>
          <View style={s.cardHeader}>
            <Text style={s.cardTitle}>Account Details</Text>
            {!editing ? (
              <TouchableOpacity onPress={() => setEditing(true)} style={s.editBtn}>
                <Ionicons name="pencil" size={15} color={C.primary} />
                <Text style={s.editBtnText}>Edit</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={() => setEditing(false)} style={s.editBtn}>
                <Ionicons name="close" size={15} color={C.sub} />
                <Text style={[s.editBtnText, { color: C.sub }]}>Cancel</Text>
              </TouchableOpacity>
            )}
          </View>

          <Field
            label="Full Name"
            value={fullName}
            editable={editing}
            onChangeText={setFullName}
            icon="person"
          />
          <Field
            label="Email Address"
            value={email}
            editable={false}
            icon="mail"
          />
          <Field
            label="Phone Number"
            value={phone}
            editable={editing}
            onChangeText={setPhone}
            placeholder="+251 9XX XXX XXX"
            keyboardType="phone-pad"
            icon="call"
          />
          <Field
            label="Account ID"
            value={uid ? uid.slice(0, 12) + '...' : '—'}
            editable={false}
            icon="finger-print"
          />
          <Field
            label="Member Since"
            value={joined}
            editable={false}
            icon="calendar"
          />
        </View>

        <View style={s.infoCard}>
          <Ionicons name="shield-checkmark-outline" size={18} color={C.success} />
          <Text style={s.infoText}>
            Your personal data is protected and never shared with third parties without your consent.
          </Text>
        </View>

        {editing && (
          <TouchableOpacity
            style={[s.saveBtn, saving && s.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            <Ionicons name="checkmark-circle" size={20} color={C.white} />
            <Text style={s.saveBtnText}>{saving ? 'Saving...' : 'Save Changes'}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  scroll:    { padding: 20 },

  avatarRow: { alignItems: 'center', marginBottom: 28 },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText:  { fontSize: 32, fontWeight: '700', color: C.white },
  avatarName:  { fontSize: 18, fontWeight: '700', color: C.text },
  avatarSub:   { fontSize: 13, color: C.sub, marginTop: 4 },

  card: {
    backgroundColor: C.white, borderRadius: 16,
    borderWidth: 1, borderColor: C.border, marginBottom: 16,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: C.text },
  editBtn:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  editBtnText: { fontSize: 14, fontWeight: '600', color: C.primary },

  field: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
    gap: 12,
  },
  fieldIcon: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: C.light, alignItems: 'center', justifyContent: 'center',
  },
  fieldBody: { flex: 1 },
  fieldLabel: { fontSize: 11, color: C.sub, fontWeight: '500', marginBottom: 2 },
  fieldValue: { fontSize: 14, fontWeight: '600', color: C.text },
  fieldInput: {
    fontSize: 14, fontWeight: '600', color: C.text,
    borderBottomWidth: 1.5, borderBottomColor: C.primary,
    paddingBottom: 2,
  },

  infoCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#F0FDF4', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#BBF7D0', marginBottom: 20,
  },
  infoText: { flex: 1, fontSize: 13, color: C.text, lineHeight: 19 },

  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.primary, borderRadius: 14, paddingVertical: 16, gap: 8,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: C.white },
});
