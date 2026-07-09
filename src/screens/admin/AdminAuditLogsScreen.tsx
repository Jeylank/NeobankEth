import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import AdminGuard from '../../components/AdminGuard';
import { adminService } from '../../services/adminService';

const COLORS = {
  primary: '#006633',
  white: '#FFFFFF',
  background: '#F5F5F5',
  text: '#1F2937',
  textSecondary: '#6B7280',
  border: '#E5E7EB',
  green: '#10B981',
  blue: '#3B82F6',
  red: '#EF4444',
  amber: '#F59E0B',
  purple: '#8B5CF6',
  teal: '#0D9488',
};

const EVENT_TYPES = [
  'LOGIN',
  'SEND_MONEY',
  'AGENT_ASSIGNED',
  'OTP_GENERATED',
  'PAYOUT_COMPLETED',
  'KYC_CHANGE',
  'ADMIN_ACTION',
] as const;

function typeColor(type: string): string {
  switch (type) {
    case 'LOGIN': return COLORS.blue;
    case 'SEND_MONEY': return COLORS.green;
    case 'AGENT_ASSIGNED': return COLORS.purple;
    case 'OTP_GENERATED': return COLORS.amber;
    case 'PAYOUT_COMPLETED': return COLORS.teal;
    case 'KYC_CHANGE': return COLORS.primary;
    case 'ADMIN_ACTION': return COLORS.red;
    default: return COLORS.textSecondary;
  }
}

function typeIcon(type: string): keyof typeof Ionicons.glyphMap {
  switch (type) {
    case 'LOGIN': return 'log-in-outline';
    case 'SEND_MONEY': return 'send-outline';
    case 'AGENT_ASSIGNED': return 'person-outline';
    case 'OTP_GENERATED': return 'key-outline';
    case 'PAYOUT_COMPLETED': return 'checkmark-done-outline';
    case 'KYC_CHANGE': return 'document-text-outline';
    case 'ADMIN_ACTION': return 'shield-outline';
    default: return 'ellipse-outline';
  }
}

function AdminAuditLogsContent() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();

  const [searchText, setSearchText] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [activeUserFilter, setActiveUserFilter] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [activeStartDate, setActiveStartDate] = useState('');
  const [activeEndDate, setActiveEndDate] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<any | null>(null);

  const queryParams = useMemo(
    () => ({
      type: selectedTypes.length > 0 ? selectedTypes.join(',') : undefined,
      userId: activeUserFilter.trim() || undefined,
      q: activeQuery.trim() || undefined,
      startDate: activeStartDate.trim() || undefined,
      endDate: activeEndDate.trim() || undefined,
      limit: 150,
    }),
    [selectedTypes, activeUserFilter, activeQuery, activeStartDate, activeEndDate],
  );

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['admin-audit-logs', queryParams],
    queryFn: () => adminService.getAuditLogs(queryParams),
  });

  const events = data?.events ?? [];

  function toggleType(type: string) {
    setSelectedTypes((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));
  }

  function applyFilters() {
    setActiveQuery(searchText);
    setActiveUserFilter(userFilter);
    setActiveStartDate(startDate);
    setActiveEndDate(endDate);
    setFiltersOpen(false);
  }

  function clearFilters() {
    setSearchText('');
    setUserFilter('');
    setStartDate('');
    setEndDate('');
    setSelectedTypes([]);
    setActiveQuery('');
    setActiveUserFilter('');
    setActiveStartDate('');
    setActiveEndDate('');
  }

  const hasActiveFilters =
    Boolean(activeQuery || activeUserFilter || activeStartDate || activeEndDate) || selectedTypes.length > 0;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={COLORS.white} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Ionicons name="list-outline" size={24} color={COLORS.white} />
          <Text style={styles.headerTitle}>{t('admin.auditLogs.title')}</Text>
        </View>
        <TouchableOpacity onPress={() => setFiltersOpen(true)} style={styles.backBtn}>
          <Ionicons name="filter-outline" size={22} color={COLORS.white} />
          {hasActiveFilters && <View style={styles.filterDot} />}
        </TouchableOpacity>
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={18} color={COLORS.textSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder={t('admin.auditLogs.searchPlaceholder')}
          placeholderTextColor={COLORS.textSecondary}
          value={searchText}
          onChangeText={setSearchText}
          onSubmitEditing={applyFilters}
          returnKeyType="search"
          autoCapitalize="none"
        />
        {searchText.length > 0 && (
          <TouchableOpacity onPress={() => { setSearchText(''); setActiveQuery(''); }}>
            <Ionicons name="close-circle" size={18} color={COLORS.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {hasActiveFilters && (
        <TouchableOpacity style={styles.clearFiltersRow} onPress={clearFilters}>
          <Ionicons name="close-circle-outline" size={14} color={COLORS.red} />
          <Text style={styles.clearFiltersText}>{t('admin.auditLogs.clearFilters')}</Text>
        </TouchableOpacity>
      )}

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} colors={[COLORS.primary]} />}
      >
        {isLoading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={COLORS.primary} />
          </View>
        ) : error ? (
          <View style={styles.centerBox}>
            <Ionicons name="alert-circle-outline" size={32} color={COLORS.red} />
            <Text style={styles.errorText}>{t('admin.auditLogs.loadError')}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()}>
              <Text style={styles.retryBtnText}>{t('common.retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : events.length === 0 ? (
          <View style={styles.centerBox}>
            <Ionicons name="document-outline" size={32} color={COLORS.textSecondary} />
            <Text style={styles.errorText}>{t('admin.auditLogs.noResults')}</Text>
          </View>
        ) : (
          <>
            <Text style={styles.resultCount}>{t('admin.auditLogs.resultCount', { count: data?.total ?? events.length })}</Text>
            {events.map((ev: any) => (
              <TouchableOpacity key={ev.id} style={styles.row} onPress={() => setSelectedEvent(ev)}>
                <View style={[styles.typeIconWrap, { backgroundColor: `${typeColor(ev.type)}20` }]}>
                  <Ionicons name={typeIcon(ev.type)} size={16} color={typeColor(ev.type)} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.rowTop}>
                    <View style={[styles.typePill, { backgroundColor: `${typeColor(ev.type)}20` }]}>
                      <Text style={[styles.typePillText, { color: typeColor(ev.type) }]}>{t(`admin.auditLogs.types.${ev.type}`)}</Text>
                    </View>
                    <Text style={styles.timeText}>{new Date(ev.timestamp).toLocaleString()}</Text>
                  </View>
                  <Text style={styles.description} numberOfLines={2}>{ev.description}</Text>
                  {ev.userId && <Text style={styles.metaText} numberOfLines={1}>{t('admin.auditLogs.user')}: {ev.userId}</Text>}
                </View>
              </TouchableOpacity>
            ))}
          </>
        )}
      </ScrollView>

      {/* Filters modal */}
      <Modal visible={filtersOpen} animationType="slide" transparent onRequestClose={() => setFiltersOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.filterSheet}>
            <View style={styles.filterHeaderRow}>
              <Text style={styles.sectionTitle}>{t('admin.auditLogs.filters')}</Text>
              <TouchableOpacity onPress={() => setFiltersOpen(false)}>
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            <ScrollView>
              <Text style={styles.filterLabel}>{t('admin.auditLogs.eventType')}</Text>
              <View style={styles.typeChipsWrap}>
                {EVENT_TYPES.map((type) => {
                  const active = selectedTypes.includes(type);
                  return (
                    <TouchableOpacity
                      key={type}
                      style={[
                        styles.typeChip,
                        { borderColor: typeColor(type) },
                        active && { backgroundColor: typeColor(type) },
                      ]}
                      onPress={() => toggleType(type)}
                    >
                      <Text style={[styles.typeChipText, { color: active ? COLORS.white : typeColor(type) }]}>
                        {t(`admin.auditLogs.types.${type}`)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.filterLabel}>{t('admin.auditLogs.userIdFilter')}</Text>
              <TextInput
                style={styles.filterInput}
                placeholder={t('admin.auditLogs.userIdPlaceholder')}
                placeholderTextColor={COLORS.textSecondary}
                value={userFilter}
                onChangeText={setUserFilter}
                autoCapitalize="none"
              />

              <Text style={styles.filterLabel}>{t('admin.auditLogs.startDate')}</Text>
              <TextInput
                style={styles.filterInput}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={COLORS.textSecondary}
                value={startDate}
                onChangeText={setStartDate}
                autoCapitalize="none"
              />

              <Text style={styles.filterLabel}>{t('admin.auditLogs.endDate')}</Text>
              <TextInput
                style={styles.filterInput}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={COLORS.textSecondary}
                value={endDate}
                onChangeText={setEndDate}
                autoCapitalize="none"
              />
            </ScrollView>

            <TouchableOpacity style={styles.applyBtn} onPress={applyFilters}>
              <Text style={styles.applyBtnText}>{t('admin.auditLogs.applyFilters')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Event detail modal */}
      <Modal visible={Boolean(selectedEvent)} animationType="slide" onRequestClose={() => setSelectedEvent(null)}>
        <SafeAreaView style={styles.container}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => setSelectedEvent(null)} style={styles.backBtn}>
              <Ionicons name="close" size={24} color={COLORS.white} />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle}>{t('admin.auditLogs.eventDetail')}</Text>
            </View>
            <View style={styles.backBtn} />
          </View>
          {selectedEvent && (
            <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
              <View style={styles.sectionCard}>
                <View style={[styles.typePill, { backgroundColor: `${typeColor(selectedEvent.type)}20`, alignSelf: 'flex-start' }]}>
                  <Text style={[styles.typePillText, { color: typeColor(selectedEvent.type) }]}>{t(`admin.auditLogs.types.${selectedEvent.type}`)}</Text>
                </View>
                <Text style={[styles.description, { marginTop: 10 }]}>{selectedEvent.description}</Text>
                <View style={styles.detailGrid}>
                  <DetailRow label={t('admin.auditLogs.timestamp')} value={new Date(selectedEvent.timestamp).toLocaleString()} />
                  {selectedEvent.userId && <DetailRow label={t('admin.auditLogs.user')} value={selectedEvent.userId} />}
                  {selectedEvent.actorId && <DetailRow label={t('admin.auditLogs.actor')} value={selectedEvent.actorId} />}
                </View>
              </View>
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>{t('admin.auditLogs.metadata')}</Text>
                {Object.entries(selectedEvent.metadata ?? {}).map(([key, value]) => (
                  <DetailRow key={key} label={key} value={typeof value === 'object' ? JSON.stringify(value) : String(value)} />
                ))}
              </View>
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.limitRow}>
      <Text style={styles.limitLabel}>{label}</Text>
      <Text style={styles.limitValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

export default function AdminAuditLogsScreen() {
  return (
    <AdminGuard>
      <AdminAuditLogsContent />
    </AdminGuard>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  filterDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F59E0B',
  },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: COLORS.white },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  searchInput: { flex: 1, fontSize: 14, color: COLORS.text },
  clearFiltersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginHorizontal: 16,
    marginTop: 8,
  },
  clearFiltersText: { fontSize: 12, color: COLORS.red, fontWeight: '600' },
  content: { flex: 1, marginTop: 12 },
  contentInner: { padding: 16, paddingBottom: 32 },
  centerBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 64, gap: 12 },
  errorText: { fontSize: 14, color: COLORS.textSecondary },
  retryBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  retryBtnText: { color: COLORS.white, fontWeight: '600' },
  resultCount: { fontSize: 12, color: COLORS.textSecondary, marginBottom: 8 },
  row: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  typeIconWrap: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 },
  typePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  typePillText: { fontSize: 10, fontWeight: '700' },
  timeText: { fontSize: 11, color: COLORS.textSecondary },
  description: { fontSize: 13, color: COLORS.text, fontWeight: '500' },
  metaText: { fontSize: 11, color: COLORS.textSecondary, marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  filterSheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '85%',
  },
  filterHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  filterLabel: { fontSize: 12, fontWeight: '700', color: COLORS.textSecondary, marginTop: 16, marginBottom: 8, textTransform: 'uppercase' },
  typeChipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1.5 },
  typeChipText: { fontSize: 12, fontWeight: '600' },
  filterInput: {
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: COLORS.text,
  },
  applyBtn: { backgroundColor: COLORS.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  applyBtnText: { color: COLORS.white, fontWeight: '700', fontSize: 15 },
  sectionCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  detailGrid: { gap: 4, marginTop: 12 },
  limitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 8,
  },
  limitLabel: { fontSize: 13, color: COLORS.textSecondary },
  limitValue: { fontSize: 13, fontWeight: '600', color: COLORS.text, flexShrink: 1, textAlign: 'right' },
});
