// src/types.ts

export type JciMeetingType = 'SEIFUKU_1' | 'SEIFUKU_2' | 'JOUNIN' | 'RIJIKAI';
export type SeatingStrategy = 'STANDARD' | 'KYOTO_FIXED' | 'SUMMER_CON';

// Inscription indispensable pour le Dashboard v2
export interface MeetingCycle {
  id: string;
  year: number;
  month: number;
  title: string;
  created_at: string;
  updated_at: string;
  meetings?: Meeting[];
}

export interface Meeting {
  id: string;
  cycle_id: string;
  type: JciMeetingType;
  location_name: string;
  address: string | null;
  phone: string | null;
  responsible_person: string;
  meeting_date: string;
  soumu_check_date: string | null;
  link_check_1_date: string | null;
  link_check_2_date: string | null;
  seating_strategy: SeatingStrategy;
  is_closed: boolean;
  created_at: string;
}

// Contrat requis par l'ActionCalendar pour indexer les jalons
export interface CalendarEvent {
  date: string;
  title: string;
  type: 'MEETING' | 'SOUMU_CHECK' | 'LINK_CHECK_1' | 'LINK_CHECK_2';
  meetingType: JciMeetingType;
}

// --- CONTRATS POUR LE REGISTRE DES DÉLÉGATIONS (MEIBO) ---

export interface Lom {
  id: number;
  name: string;
  name_kana: string;
  sort_priority: number;
  block?: string;  // Identifiant géographique large (ex: Kanto)
  region?: string; // Sous-identifiant géographique (ex: Kanagawa)
}

// Identité pure d'un délégué, valable pour toute l'année (mandate_year).
// Ne contient PLUS aucune donnée d'émargement : celle-ci est désormais
// scoppée par réunion dans la table `attendances` (voir plus bas).
export interface Participant {
  id: string;
  auth_id: string;
  mandate_year: number;
  last_name: string;
  first_name: string;
  last_name_kana: string;
  first_name_kana: string;
  lom_id?: number;
  loms?: Lom;
}

// --- CONTRAT POUR LE REGISTRE D'ÉMARGEMENT (une ligne par participant PAR réunion) ---

export interface Attendance {
  id: string;
  meeting_id: string;
  participant_id: string;
  checked_in: boolean;
  participation_mode: '現地' | 'ZOOM' | 'ABSENT';
  has_omiyage: boolean;
  omiyage_shop: string | null;
  omiyage_item: string | null;
  assigned_seat: string | null;      // Siège individuel (président) — KYOTO_FIXED / SUMMER_CON
  member_seat_range: string | null;  // Zone collective (membres escorte) — SUMMER_CON
  lom_members_count: number | null;  // Nombre de membres accompagnants déclarés — SUMMER_CON
  created_at: string;
  updated_at: string;
}

// --- CONTRAT POUR LE PLAN DE SALLE BRUT (座席プラン) ---
// Reflète les règles du CSV telles quelles, indépendamment de qui occupe réellement
// chaque siège — nécessaire pour afficher les places "prévues mais non réservées" (blanc)
// dans le plan de salle.

export type SeatPlanRole = 'PRESIDENT' | 'MEMBER';
export type SeatPlanTargetType = 'LOM' | 'BLOCK_DISTRICT' | 'NONE';

export interface SeatPlanRule {
  id: string;
  meeting_id: string;
  role: SeatPlanRole;
  target_type: SeatPlanTargetType;
  target_name: string | null;
  start_seat: string;
  end_seat: string | null;
  created_at: string;
}

// --- CONTRAT POUR LA GESTION DES ÉQUIPEMENTS (備品管理) ---
// Indépendant des cycles de réunion : un inventaire par TYPE de réunion,
// pas par instance datée.

export type EquipmentCategory = 'SEIFUKU' | 'JOUNIN' | 'RIJIKAI' | 'SOUKAI' | 'KYOTO_KAIGI' | 'SUMMER_CON';
export type EquipmentLocation = 'OFFICE' | 'VENUE' | 'SAITAMA_WAREHOUSE' | 'MEMBER' | 'UNKNOWN';

export interface Equipment {
  id: string;
  category: EquipmentCategory;
  name: string;
  quantity: number;
  location: EquipmentLocation;
  notes: string | null;
  created_at: string;
  updated_at: string;
}