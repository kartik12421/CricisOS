import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Linking, Pressable, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Analytics, Assignment, CrisisAlert, crisisApi, flushOutbox, Incident,
  Responder, restoreSession, Session, setAuthErrorHandler, subscribeEvents,
} from "@/src/crisis-api";
import { AlertComposer } from "@/src/components/alert-composer";
import { AlertsStrip } from "@/src/components/alerts-strip";
import { AnalyticsPanel } from "@/src/components/analytics-panel";
import { AuthScreen } from "@/src/components/auth-screen";
import { CrisisMap } from "@/src/components/crisis-map";
import { CrisisMapMarker } from "@/src/components/crisis-map-utils";
import { SosComposer } from "@/src/components/sos-composer";
import { Badge, EmptyState, formatTime, MediaThumbs, Notice } from "@/src/components/ui";
import { DevicePoint, ensureLocationPermission, watchDeviceLocation } from "@/src/location";
import { makeStyles, useTheme } from "@/src/theme";

/**
 * Realtime sync: a single WebSocket per session drives refreshes (debounced),
 * with a slow 30s poll as a safety net when the socket drops.
 */
function useCrisisSync(enabled: boolean) {
  const [connected, setConnected] = useState(false);
  const [signal, setSignal] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bump = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => { timerRef.current = null; setSignal((value) => value + 1); }, 400);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = subscribeEvents(bump, setConnected);
    const fallback = setInterval(bump, 30000);
    return () => { unsubscribe(); clearInterval(fallback); };
  }, [enabled, bump]);
  return { connected, signal };
}

export default function Index() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();
  const [booted, setBooted] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const { connected, signal } = useCrisisSync(session !== null);

  useEffect(() => {
    setAuthErrorHandler(() => setSession(null));
    void restoreSession().then((restored) => { if (restored) setSession(restored); setBooted(true); });
  }, []);

  const signIn = async (email: string, password: string) => { setSession(await crisisApi.login(email, password)); };
  const signUp = async (name: string, email: string, password: string) => { setSession(await crisisApi.signup(name, email, password)); };
  const logout = async () => { await crisisApi.logout(); setSession(null); };

  if (!booted) {
    return <View style={[styles.root, styles.bootCenter, { paddingTop: insets.top }]}><ActivityIndicator color={colors.brandSecondary} size="large" /><Text style={styles.bootText}>CONNECTING TO CRISISOS…</Text></View>;
  }
  if (!session) return <AuthScreen onSignIn={signIn} onSignUp={signUp} />;
  const role = session.role;
  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <Header session={session} connected={connected} onLogout={logout} />
      {role === "CITIZEN" ? <CitizenView signal={signal} /> : role === "RESPONDER" ? <ResponderView signal={signal} /> : <CommandView signal={signal} />}
    </View>
  );
}

function Header({ session, connected, onLogout }: { session: Session; connected: boolean; onLogout: () => void }) {
  const styles = useStyles(); const { colors } = useTheme();
  return <View style={styles.header}><View style={styles.flex}><Text style={styles.brand}>CRISISOS</Text><Text style={styles.headerMeta}>{session.role === "CITIZEN" ? "CITIZEN SAFETY" : session.role === "RESPONDER" ? "FIELD OPERATIONS" : "COMMAND CENTER"} · {session.name.toUpperCase()}</Text></View><View style={styles.headerRight}><View testID="connection-pill" style={[styles.online, !connected && styles.onlineWarn]}><View style={[styles.onlineDot, !connected && { backgroundColor: colors.warning }]} /><Text style={[styles.onlineText, !connected && { color: colors.warning }]}>{connected ? "LIVE" : "RECONNECTING"}</Text></View><Pressable testID="logout-button" onPress={onLogout} accessibilityRole="button" hitSlop={8}><Ionicons name="log-out-outline" size={22} color={colors.muted} /></Pressable></View></View>;
}

function CitizenView({ signal }: { signal: number }) {
  const styles = useStyles(); const { colors } = useTheme();
  const [incidents, setIncidents] = useState<Incident[]>([]); const [alerts, setAlerts] = useState<CrisisAlert[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [composer, setComposer] = useState(false); const [queued, setQueued] = useState(0);
  const refresh = useCallback(async () => { try { setError(""); const [i, a] = await Promise.all([crisisApi.incidents(), crisisApi.alerts()]); setIncidents(i); setAlerts(a); } catch (e) { setError(e instanceof Error ? e.message : "Unable to connect to CrisisOS."); } finally { setLoading(false); } }, []);
  useEffect(() => { refresh(); }, [signal, refresh]);
  // Offline outbox: flush on mount, on reconnect, and periodically.
  useEffect(() => {
    let cancelled = false;
    const flush = async () => { const result = await flushOutbox(); if (cancelled) return; setQueued(result.remaining); if (result.sent.length > 0) refresh(); };
    void flush();
    const timer = setInterval(() => { void flush(); }, 15000);
    const canListen = typeof window !== "undefined" && typeof window.addEventListener === "function";
    const onOnline = () => { void flush(); };
    if (canListen) window.addEventListener("online", onOnline);
    return () => { cancelled = true; clearInterval(timer); if (canListen) window.removeEventListener("online", onOnline); };
  }, [refresh]);
  // Show SOS button always (allow multiple concurrent emergencies)
  const hasActiveIncident = incidents.some((item) => !["RESOLVED", "CLOSED", "CANCELLED"].includes(item.status));
  const activeIncident = incidents.find((item) => !["RESOLVED", "CLOSED", "CANCELLED"].includes(item.status));
  return <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <View style={styles.sectionHeader}><View style={styles.flex}><Text style={styles.eyebrow}>PERSONAL SAFETY</Text><Text style={styles.screenTitle}>Ready when you need us.</Text></View><View style={styles.locationBadge}><Ionicons name="location-outline" size={15} color={colors.success} /><Text style={styles.locationText}>LOCATION READY</Text></View></View>
    {error ? <Notice text={error} tone="error" onPress={refresh} /> : null}
    <AlertsStrip alerts={alerts} />
    {queued > 0 ? <View testID="sos-outbox-banner"><Notice text={`${queued} SOS ${queued === 1 ? "is" : "are"} queued offline — auto-send when connection returns.`} tone="info" /></View> : null}
    {hasActiveIncident && activeIncident ? <StatusCard incident={activeIncident} /> : null}
    <View style={styles.sosPanel}><Text style={styles.sosEyebrow}>EMERGENCY SIGNAL</Text><Text style={styles.sosTitle}>Need immediate help?</Text><Text style={styles.sosBody}>Your location and emergency details will be shared with the Command Center after confirmation.</Text><Pressable testID="send-sos" accessibilityRole="button" onPress={() => setComposer(true)} style={({ pressed }) => [styles.sosButton, pressed && styles.sosPressed]}><Ionicons name="alert-circle" size={32} color={colors.onBrandPrimary} /><Text style={styles.sosButtonText}>SEND SOS</Text></Pressable><Text style={styles.sosHint}>Only press for a real emergency</Text></View>
    <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>RECENT INCIDENTS</Text>{loading ? <ActivityIndicator color={colors.brandSecondary} /> : null}</View>
    {incidents.length === 0 && !loading ? <EmptyState icon="shield-checkmark-outline" text="No active emergency history." /> : incidents.slice(0, 3).map((incident) => <IncidentRow key={incident.id} incident={incident} />)}
    <View style={styles.infoStrip}><Ionicons name="information-circle-outline" size={19} color={colors.info} /><Text style={styles.infoText}>Location sharing is used only when you send an SOS. You stay in control.</Text></View>
    <SosComposer visible={composer} onClose={() => setComposer(false)} onCreated={(incident) => { setIncidents((current) => [incident, ...current]); setComposer(false); }} onQueued={(count) => { setQueued(count); setComposer(false); }} />
  </ScrollView>;
}

function StatusCard({ incident }: { incident: Incident }) { const styles = useStyles(); const { colors } = useTheme(); const steps = ["ACKNOWLEDGED", "ACTIVE_RESPONSE", "ON_SCENE", "RESOLVED"]; const current = incident.status === "ASSIGNED" ? 1 : steps.indexOf(incident.status); return <View style={styles.statusCard}><View style={styles.statusTop}><View style={styles.statusHeading}><Text style={styles.eyebrow}>ACTIVE EMERGENCY</Text><Text style={styles.statusTitle}>{incident.title}</Text></View><Badge text={incident.status.replace("_", " ")} tone={incident.status === "RESOLVED" ? "success" : "warning"} /></View><Text style={styles.statusSummary}>{incident.ai_analysis.summary}</Text>{incident.media && incident.media.length > 0 ? <View style={styles.mediaSpacing}><MediaThumbs media={incident.media} /></View> : null}<View style={styles.timeline}>{steps.map((step, index) => <View key={step} style={styles.timelineItem}><View style={[styles.timelineDot, index <= current && styles.timelineDotActive]}>{index <= current ? <Ionicons name="checkmark" size={11} color={colors.onBrandPrimary} /> : null}</View><Text style={[styles.timelineText, index <= current && styles.timelineTextActive]}>{step.replace("_", " ")}</Text>{index < steps.length - 1 ? <View style={[styles.timelineLine, index < current && styles.timelineLineActive]} /> : null}</View>)}</View></View>; }

function CommandView({ signal }: { signal: number }) {
  const styles = useStyles(); const { colors } = useTheme(); const [incidents, setIncidents] = useState<Incident[]>([]); const [responders, setResponders] = useState<Responder[]>([]); const [assignments, setAssignments] = useState<Assignment[]>([]); const [analytics, setAnalytics] = useState<Analytics | null>(null); const [selected, setSelected] = useState<Incident | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [alertComposer, setAlertComposer] = useState(false);
  const refresh = useCallback(async () => { try { setError(""); const [i, r, a, k] = await Promise.all([crisisApi.incidents(), crisisApi.responders(), crisisApi.assignments(), crisisApi.analytics()]); setIncidents(i); setResponders(r); setAssignments(a); setAnalytics(k); setSelected((current) => i.find((item) => item.id === current?.id) ?? i[0] ?? null); } catch (e) { setError(e instanceof Error ? e.message : "Unable to load command queue."); } }, []);
  useEffect(() => { refresh(); }, [signal, refresh]);
  const selectedAssignment = assignments.find((item) => item.incident_id === selected?.id && !["COMPLETED", "CANCELLED"].includes(item.status));
  const opsMarkers = compactMarkers([...incidents.map(incidentMarker), ...responders.map(responderMarker)]);
  const approve = async () => { if (!selected || !responders[0]) return; setBusy(true); try { await crisisApi.approveDispatch(selected.id, responders[0].id); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Dispatch approval failed."); } finally { setBusy(false); } };
  return <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}><View style={styles.sectionHeader}><View style={styles.flex}><Text style={styles.eyebrow}>OPERATIONS / LIVE QUEUE</Text><Text style={styles.screenTitle}>Command Center</Text></View><View style={styles.headerActions}><Pressable testID="publish-alert-button" onPress={() => setAlertComposer(true)} accessibilityRole="button" style={styles.iconButton}><Ionicons name="megaphone-outline" size={18} color={colors.brandSecondary} /></Pressable><Pressable testID="command-refresh-button" onPress={refresh} accessibilityRole="button" style={styles.iconButton}><Ionicons name="refresh" size={18} color={colors.onSurfaceSecondary} /></Pressable></View></View>{error ? <Notice text={error} tone="error" onPress={refresh} /> : null}<View style={styles.kpiRow}><Kpi label="ACTIVE" value={String(analytics?.active_incidents ?? 0)} tone="warning" /><Kpi label="CRITICAL" value={String(analytics?.critical_incidents ?? 0)} tone="error" /><Kpi label="APPROVED" value={String(analytics?.human_approvals ?? 0)} tone="success" /></View><Text style={styles.sectionTitle}>LIVE OPERATIONS MAP</Text><CrisisMap testID="command-ops-map" markers={opsMarkers} height={220} /><Text style={styles.sectionTitle}>ANALYTICS</Text><AnalyticsPanel analytics={analytics} /><Text style={styles.sectionTitle}>INCIDENT QUEUE</Text>{incidents.length === 0 ? <EmptyState icon="checkmark-done-outline" text="All regional incidents resolved or under control." /> : incidents.map((incident) => <Pressable key={incident.id} testID={`incident-card-${incident.id}`} onPress={() => setSelected(incident)} style={[styles.queueCard, selected?.id === incident.id && styles.queueCardActive]}><View style={styles.queueTop}><Badge text={incident.severity} tone={incident.severity === "CRITICAL" ? "error" : "warning"} /><Text style={styles.queueTime}>{formatTime(incident.created_at)}</Text></View><Text style={styles.queueTitle}>{incident.title}</Text><Text style={styles.queueDescription} numberOfLines={2}>{incident.description}</Text><View style={styles.queueFooter}><Text style={styles.queueMeta}>{incident.affected_people} people · {incident.location.source ?? "UNKNOWN"}{incident.media?.length ? " · PHOTO" : ""}</Text><Ionicons name="chevron-forward" size={18} color={colors.muted} /></View></Pressable>)}{selected ? <View style={styles.reviewPanel}><View style={styles.reviewHeader}><View><Text style={styles.eyebrow}>HUMAN REVIEW REQUIRED</Text><Text style={styles.reviewTitle}>AI response recommendation</Text></View><Badge text={`${Math.round(selected.ai_analysis.confidence * 100)}% CONF.`} tone="info" /></View><Text style={styles.reviewSummary}>{selected.ai_analysis.summary}</Text>{selected.media && selected.media.length > 0 ? <MediaThumbs media={selected.media} /> : null}{selected.ai_analysis.provider ? <Text style={styles.providerMeta}>ANALYSIS: {selected.ai_analysis.provider.toUpperCase()}</Text> : null}<View style={styles.capabilityRow}>{selected.ai_analysis.required_capabilities.map((capability) => <View key={capability} style={styles.capability}><Text style={styles.capabilityText}>{capability.replace("_", " ")}</Text></View>)}</View>{selectedAssignment ? <View style={styles.assignmentNotice}><Ionicons name="checkmark-circle" size={20} color={colors.success} /><View style={styles.flex}><Text style={styles.assignmentTitle}>Dispatch approved</Text><Text style={styles.assignmentDetail}>{selectedAssignment.responder_name} · {selectedAssignment.status.replace("_", " ")}</Text></View></View> : <><Text style={styles.inputLabel}>DETERMINISTIC MATCHING / AVAILABLE RESPONDERS</Text>{responders.slice(0, 3).map((responder, index) => <View key={responder.id} style={styles.responderRow}><View style={styles.responderIcon}><Ionicons name="shield-outline" size={18} color={colors.brandSecondary} /></View><View style={styles.flex}><Text style={styles.responderName}>{responder.name}</Text><Text style={styles.responderDetail}>{responder.team} · {responder.distance_km} km</Text></View><Text style={styles.matchScore}>{[94, 87, 74][index]}%</Text></View>)}<Pressable testID="approve-dispatch-button" onPress={approve} disabled={busy} style={({ pressed }) => [styles.approveButton, pressed && styles.pressed, busy && styles.disabled]}>{busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><Ionicons name="checkmark-circle-outline" size={20} color={colors.onBrandPrimary} /><Text style={styles.approveText}>APPROVE DISPATCH</Text></>}</Pressable><Text style={styles.approvalNote}>AI cannot dispatch. This action is recorded in the audit log.</Text></>}</View> : null}<AlertComposer visible={alertComposer} onClose={() => setAlertComposer(false)} onPublished={() => { setAlertComposer(false); void refresh(); }} /></ScrollView>;
}

function ResponderView({ signal }: { signal: number }) {
  const styles = useStyles(); const { colors } = useTheme(); const [assignments, setAssignments] = useState<Assignment[]>([]); const [incidents, setIncidents] = useState<Incident[]>([]); const [alerts, setAlerts] = useState<CrisisAlert[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [selfPoint, setSelfPoint] = useState<DevicePoint | null>(null); const [locationBlocked, setLocationBlocked] = useState(false);
  const refresh = useCallback(async () => { try { setError(""); const [a, i, al] = await Promise.all([crisisApi.assignments(), crisisApi.incidents(), crisisApi.alerts()]); setAssignments(a); setIncidents(i); setAlerts(al); } catch (e) { setError(e instanceof Error ? e.message : "Unable to load assignments."); } }, []);
  useEffect(() => { refresh(); }, [signal, refresh]);
  const assignment = assignments.find((item) => !["COMPLETED", "CANCELLED"].includes(item.status)); const incident = incidents.find((item) => item.id === assignment?.incident_id); const next = assignment ? ({ ASSIGNED: "ACCEPTED", ACCEPTED: "EN_ROUTE", EN_ROUTE: "ON_SCENE", ON_SCENE: "COMPLETED" } as Record<string, string>)[assignment.status] : null;
  // Operational location sharing: only during EN_ROUTE / ON_SCENE, for THIS unit.
  useEffect(() => {
    if (!assignment || !["EN_ROUTE", "ON_SCENE"].includes(assignment.status)) return;
    const responderId = assignment.responder_id;
    let stop: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      const permission = await ensureLocationPermission();
      if (cancelled) return;
      if (permission === "blocked") { setLocationBlocked(true); return; }
      setLocationBlocked(false);
      const stopWatching = await watchDeviceLocation((point) => { setSelfPoint(point); void crisisApi.updateResponderLocation(responderId, point); });
      if (cancelled) stopWatching(); else stop = stopWatching;
    })();
    return () => { cancelled = true; stop?.(); };
  }, [assignment]);
  const advance = async () => { if (!assignment || !next) return; setBusy(true); try { await crisisApi.updateAssignment(assignment.id, next, next === "EN_ROUTE" ? "Operational response started." : "Status updated from responder mission control."); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Status update failed."); } finally { setBusy(false); } };
  const mapMarkers = compactMarkers([incident ? incidentMarker(incident) : null, pointMarker(selfPoint)]);
  return <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}><View style={styles.sectionHeader}><View><Text style={styles.eyebrow}>UNIT / ALPHA RESPONSE</Text><Text style={styles.screenTitle}>Mission Control</Text></View><View style={styles.operationalPill}><View style={styles.onlineDot} /><Text style={styles.onlineText}>AVAILABLE</Text></View></View>{error ? <Notice text={error} tone="error" onPress={refresh} /> : null}<AlertsStrip alerts={alerts} />{!assignment || !incident ? <EmptyState icon="radio-outline" text="No active dispatches assigned to this unit." /> : <><View style={styles.missionBanner}><View style={styles.missionIcon}><Ionicons name="navigate" size={22} color={colors.onBrandPrimary} /></View><View style={styles.flex}><Text style={styles.eyebrow}>ACTIVE ASSIGNMENT</Text><Text style={styles.missionTitle}>{incident.title}</Text></View><Badge text={incident.severity} tone="error" /></View>{mapMarkers.length > 0 ? <CrisisMap testID="responder-map" markers={mapMarkers} height={200} /> : <View style={styles.mapPlaceholder}><Ionicons name="map-outline" size={42} color={colors.brandSecondary} /><Text style={styles.mapTitle}>TACTICAL LOCATION VIEW</Text><Text style={styles.mapText}>{incident.location.source === "CURRENT_GPS" ? "Live GPS coordinates received" : "Location source: " + (incident.location.source ?? "UNKNOWN")}</Text><View style={styles.mapGrid} /></View>}{locationBlocked ? <Notice text="Location sharing is blocked. Open Settings to enable live tracking." tone="info" actionLabel="OPEN" onPress={() => Linking.openSettings()} /> : null}{incident.media && incident.media.length > 0 ? <MediaThumbs media={incident.media} /> : null}<View style={styles.detailGrid}><Detail label="PEOPLE" value={String(incident.affected_people)} icon="people-outline" /><Detail label="STATUS" value={assignment.status.replace("_", " ")} icon="pulse-outline" /><Detail label="CAPABILITIES" value={incident.ai_analysis.required_capabilities.join(" · ").replaceAll("_", " ")} icon="construct-outline" /></View><View style={styles.missionPanel}><Text style={styles.sectionTitle}>MISSION BRIEF</Text><Text style={styles.reviewSummary}>{incident.ai_analysis.summary}</Text><View style={styles.secureRow}><Ionicons name="lock-closed-outline" size={16} color={colors.info} /><Text style={styles.secureText}>Operational location sharing activates during EN ROUTE and ON SCENE.</Text></View><Pressable testID="assignment-advance-button" onPress={advance} disabled={busy || !next} style={({ pressed }) => [styles.approveButton, pressed && styles.pressed, busy && styles.disabled]}>{busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><Ionicons name={next === "COMPLETED" ? "checkmark-done" : "arrow-forward-circle"} size={21} color={colors.onBrandPrimary} /><Text style={styles.approveText}>{next === "COMPLETED" ? "COMPLETE ASSIGNMENT" : `MARK ${next?.replace("_", " ")}`}</Text></>}</Pressable></View></>}</ScrollView>;
}

// --- Map marker builders ----------------------------------------------------
function incidentMarker(incident: Incident): CrisisMapMarker | null {
  const coords = incident.location.coordinates ?? [];
  if (coords.length < 2) return null;
  return { id: `incident-${incident.id}`, latitude: coords[1], longitude: coords[0], kind: "incident", label: incident.title, critical: incident.severity === "CRITICAL" };
}
function responderMarker(responder: Responder): CrisisMapMarker | null {
  const coords = responder.current_location?.coordinates as number[] | undefined;
  if (!coords || coords.length < 2) return null;
  return { id: `responder-${responder.id}`, latitude: coords[1], longitude: coords[0], kind: "responder", label: responder.name };
}
function pointMarker(point: DevicePoint | null): CrisisMapMarker | null {
  const coords = point?.coordinates as number[] | undefined;
  if (!coords || coords.length < 2) return null;
  return { id: "self", latitude: coords[1], longitude: coords[0], kind: "self", label: "Your position" };
}
function compactMarkers(list: (CrisisMapMarker | null)[]): CrisisMapMarker[] {
  return list.filter((marker): marker is CrisisMapMarker => marker !== null);
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: "warning" | "error" | "success" }) { const styles = useStyles(); const { colors } = useTheme(); const color = colors[tone]; return <View style={styles.kpi}><Text style={styles.kpiLabel}>{label}</Text><Text style={[styles.kpiValue, { color }]}>{value}</Text></View>; }
function Detail({ label, value, icon }: { label: string; value: string; icon: keyof typeof Ionicons.glyphMap }) { const styles = useStyles(); const { colors } = useTheme(); return <View style={styles.detail}><Ionicons name={icon} size={17} color={colors.brandSecondary} /><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue} numberOfLines={2}>{value}</Text></View>; }
function IncidentRow({ incident }: { incident: Incident }) { const styles = useStyles(); const { colors } = useTheme(); return <View style={styles.incidentRow}><View style={styles.rowIcon}><Ionicons name="warning-outline" size={18} color={incident.severity === "CRITICAL" ? colors.error : colors.warning} /></View><View style={styles.flex}><Text style={styles.incidentTitle}>{incident.title}</Text><Text style={styles.incidentMeta}>{formatTime(incident.created_at)} · {incident.status.replace("_", " ")}{incident.media?.length ? " · PHOTO" : ""}</Text></View><Ionicons name="chevron-forward" size={17} color={colors.muted} /></View>; }

const useStyles = makeStyles((colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface }, bootCenter: { alignItems: "center", justifyContent: "center", gap: 16 }, bootText: { color: colors.muted, fontSize: 10, fontWeight: "900", letterSpacing: 1.6 }, pressed: { opacity: 0.72, transform: [{ scale: 0.985 }] }, header: { minHeight: 70, paddingHorizontal: 20, paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, borderBottomColor: colors.divider, borderBottomWidth: 1 }, brand: { color: colors.onSurface, fontSize: 20, fontWeight: "900", letterSpacing: 2 }, headerMeta: { color: colors.muted, fontSize: 10, letterSpacing: 1.2, marginTop: 4 }, headerRight: { flexDirection: "row", alignItems: "center", gap: 16 }, headerActions: { flexDirection: "row", gap: 8 }, online: { borderColor: colors.success, borderWidth: 1, borderRadius: 99, minHeight: 28, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 6 }, onlineWarn: { borderColor: colors.warning }, onlineDot: { width: 7, height: 7, borderRadius: 7, backgroundColor: colors.success }, onlineText: { color: colors.success, fontSize: 10, fontWeight: "800", letterSpacing: 1 }, content: { padding: 20, paddingBottom: 40, gap: 16 }, sectionHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }, eyebrow: { color: colors.brandSecondary, fontSize: 10, fontWeight: "900", letterSpacing: 1.5, marginBottom: 6 }, screenTitle: { color: colors.onSurface, fontSize: 27, fontWeight: "800", letterSpacing: -0.4 }, locationBadge: { borderColor: colors.border, borderWidth: 1, borderRadius: 99, paddingHorizontal: 9, minHeight: 28, flexDirection: "row", gap: 5, alignItems: "center" }, locationText: { color: colors.success, fontSize: 9, fontWeight: "800" }, sosPanel: { backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: 20, padding: 24, alignItems: "center", marginTop: 8 }, sosEyebrow: { color: colors.onBrandTertiary, fontSize: 10, fontWeight: "900", letterSpacing: 1.5 }, sosTitle: { color: colors.onSurface, fontSize: 24, fontWeight: "800", marginTop: 8 }, sosBody: { color: colors.onSurfaceSecondary, textAlign: "center", fontSize: 13, lineHeight: 20, marginTop: 9 }, sosButton: { marginTop: 20, minHeight: 76, minWidth: "80%", borderRadius: 18, backgroundColor: colors.brandPrimary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 }, sosPressed: { opacity: 0.82, transform: [{ scale: 0.97 }] }, sosButtonText: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 18, letterSpacing: 1.3 }, sosHint: { color: colors.onBrandTertiary, fontSize: 11, marginTop: 11 }, sectionTitle: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "900", letterSpacing: 1.4 }, statusCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.warning, borderWidth: 1, borderRadius: 18, padding: 18, marginTop: 8 }, statusTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }, statusHeading: { flex: 1, flexShrink: 1 }, statusTitle: { color: colors.onSurface, fontSize: 19, fontWeight: "800" }, statusSummary: { color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 21, marginTop: 14 }, mediaSpacing: { marginTop: 14 }, timeline: { marginTop: 20, gap: 0 }, timelineItem: { minHeight: 28, flexDirection: "row", alignItems: "center" }, timelineDot: { width: 18, height: 18, borderRadius: 18, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" }, timelineDotActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }, timelineText: { color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 0.4, marginLeft: 9 }, timelineTextActive: { color: colors.onSurfaceSecondary }, timelineLine: { width: 1, height: 10, backgroundColor: colors.borderStrong, marginLeft: 8.5 }, timelineLineActive: { backgroundColor: colors.brandPrimary }, incidentRow: { minHeight: 64, backgroundColor: colors.surfaceSecondary, borderRadius: 14, padding: 13, flexDirection: "row", alignItems: "center", gap: 11, borderWidth: 1, borderColor: colors.border }, rowIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" }, incidentTitle: { color: colors.onSurface, fontSize: 14, fontWeight: "700" }, incidentMeta: { color: colors.muted, fontSize: 11, marginTop: 4 }, infoStrip: { borderTopColor: colors.divider, borderTopWidth: 1, paddingTop: 15, flexDirection: "row", gap: 9, alignItems: "flex-start" }, infoText: { color: colors.muted, fontSize: 12, lineHeight: 18, flex: 1 }, inputLabel: { color: colors.muted, fontSize: 10, letterSpacing: 1.2, fontWeight: "900", marginTop: 19, marginBottom: 9 }, disabled: { opacity: 0.5 }, kpiRow: { flexDirection: "row", gap: 9 }, kpi: { flex: 1, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 13 }, kpiLabel: { color: colors.muted, fontSize: 9, fontWeight: "900", letterSpacing: 1 }, kpiValue: { fontSize: 25, fontWeight: "900", marginTop: 6 }, queueCard: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: 15, padding: 15, gap: 8 }, queueCardActive: { borderColor: colors.brandSecondary }, queueTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, queueTime: { color: colors.muted, fontSize: 11 }, queueTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "800" }, queueDescription: { color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 19 }, queueFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 3 }, queueMeta: { color: colors.muted, fontSize: 11 }, iconButton: { minWidth: 44, minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 12, alignItems: "center", justifyContent: "center" }, reviewPanel: { backgroundColor: colors.surfaceTertiary, borderRadius: 17, borderWidth: 1, borderColor: colors.borderStrong, padding: 16, gap: 12 }, reviewHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }, reviewTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "800" }, reviewSummary: { color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 21 }, providerMeta: { color: colors.muted, fontSize: 9, fontWeight: "900", letterSpacing: 1.2 }, capabilityRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, capability: { paddingVertical: 7, paddingHorizontal: 9, backgroundColor: colors.brandTertiary, borderRadius: 8 }, capabilityText: { color: colors.onBrandTertiary, fontSize: 10, fontWeight: "900", letterSpacing: 0.5 }, responderRow: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 10, borderTopColor: colors.divider, borderTopWidth: 1 }, responderIcon: { width: 32, height: 32, borderRadius: 9, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" }, responderName: { color: colors.onSurface, fontSize: 13, fontWeight: "700" }, responderDetail: { color: colors.muted, fontSize: 11, marginTop: 3 }, matchScore: { color: colors.success, fontWeight: "900", fontSize: 16 }, approveButton: { minHeight: 52, borderRadius: 12, backgroundColor: colors.brandPrimary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 }, approveText: { color: colors.onBrandPrimary, fontSize: 13, fontWeight: "900", letterSpacing: 0.8 }, approvalNote: { color: colors.muted, textAlign: "center", fontSize: 11 }, assignmentNotice: { backgroundColor: `${colors.success}18`, borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 }, assignmentTitle: { color: colors.success, fontWeight: "900", fontSize: 13 }, assignmentDetail: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 3 }, operationalPill: { borderColor: colors.success, borderWidth: 1, borderRadius: 99, minHeight: 28, paddingHorizontal: 9, flexDirection: "row", gap: 6, alignItems: "center" }, missionBanner: { backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary, borderRadius: 17, padding: 15, flexDirection: "row", alignItems: "center", gap: 11 }, missionIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" }, missionTitle: { color: colors.onSurface, fontSize: 17, fontWeight: "800" }, mapPlaceholder: { height: 190, borderRadius: 17, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", overflow: "hidden" }, mapGrid: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, opacity: 0.18, borderWidth: 1, borderColor: colors.info }, mapTitle: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: "900", letterSpacing: 1.4, marginTop: 10 }, mapText: { color: colors.muted, fontSize: 12, marginTop: 6 }, detailGrid: { flexDirection: "row", gap: 8 }, detail: { flex: 1, minHeight: 86, backgroundColor: colors.surfaceSecondary, borderRadius: 13, borderWidth: 1, borderColor: colors.border, padding: 10 }, detailLabel: { color: colors.muted, fontSize: 9, fontWeight: "900", letterSpacing: 1, marginTop: 8 }, detailValue: { color: colors.onSurface, fontSize: 12, fontWeight: "800", marginTop: 4 }, missionPanel: { backgroundColor: colors.surfaceTertiary, borderRadius: 17, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 13 }, secureRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" }, secureText: { color: colors.muted, fontSize: 11, lineHeight: 17, flex: 1 }, flex: { flex: 1 },
}));
