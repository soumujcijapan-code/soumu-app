// src/types.ts

// Seul le 理事会 est géré désormais (正副会議①② / 常任理事会 supprimés).
export type JciMeetingType = 'RIJIKAI';
export type SeatingStrategy = 'STANDARD' | 'KYOTO_FIXED' | 'SUMMER_CON';

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
  seating_strategy: SeatingStrategy;
  is_closed: boolean;
  created_at: string;
}

// --- CONTRATS POUR LE REGISTRE DES DÉLÉGATIONS (MEIBO) ---

// Un LOM existe une fois PAR année (mandate_year) : 席次, ふりがな, ブロック
// et 地区 sont propres à chaque année et ne s'écrasent plus entre 2026 et 2027.
export interface Lom {
  id: number;
  name: string;
  name_kana: string;
  sort_priority: number;
  mandate_year: number;
  block?: string;
  region?: string;
}

// Identité d'un délégué pour UNE année (unique sur auth_id + mandate_year).
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

// --- REGISTRE D'ÉMARGEMENT (une ligne par participant PAR réunion) ---

export interface Attendance {
  id: string;
  meeting_id: string;
  participant_id: string;
  checked_in: boolean;
  participation_mode: '現地' | 'ZOOM' | 'ABSENT';
  has_omiyage: boolean;
  omiyage_shop: string | null;
  omiyage_item: string | null;
  assigned_seat: string | null;
  member_seat_range: string | null;
  lom_members_count: number | null;
  created_at: string;
  updated_at: string;
}

// --- PLAN DE SALLE BRUT (座席プラン) ---

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
