import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import type { Meeting, Participant, Attendance } from '../types';
import { Users, FileText, Gift, Edit2, Check, X, RotateCcw, Trash2 } from 'lucide-react';
import { YomiageList } from './YomiageList';
import { OmiyageList } from './OmiyageList';
import { SeatMap } from './SeatMap';

interface Props {
  activeMeeting: Meeting | null;
  activeYear: number;
}

// Participant "enrichi" : infos de base + statut d'émargement fusionné pour LA réunion active
type EnrichedParticipant = Participant & {
  checked_in: boolean;
  participation_mode: '現地' | 'ZOOM';
  has_omiyage: boolean;
  omiyage_shop: string | null;
  omiyage_item: string | null;
  assigned_seat: string | null;
};

// 座席番号を数値として比較する（文字列比較だと "10" が "2" より前に来てしまうため）
const compareSeats = (a: string, b: string): number => {
  const numA = parseInt(a, 10);
  const numB = parseInt(b, 10);
  if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
  return a.localeCompare(b);
};

export const CheckInConsole: React.FC<Props> = ({ activeMeeting, activeYear }) => {
  // 1. ÉTATS GLOBAUX
  const [roster, setRoster] = useState<Participant[]>([]);
  const [attendanceMap, setAttendanceMap] = useState<Record<string, Attendance>>({});
  const [walkInPresidentPool, setWalkInPresidentPool] = useState<number[]>([]); // 当日飛び入り理事長用の空き座席プール（列Aが空の理事長枠）
  const [blockPresidentPools, setBlockPresidentPools] = useState<Record<string, number[]>>({}); // ブロック／地区名 → 確保座席（個人未定）
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'CHECKIN' | 'SUPERVISION' | 'YOMIAGE' | 'OMIYAGE_LIST' | 'SEATMAP'>('CHECKIN');

  // 2. ÉTATS DU RADAR D'ACCUEIL
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [selectedParticipant, setSelectedParticipant] = useState<EnrichedParticipant | null>(null);
  const [checkinResult, setCheckinResult] = useState<{ name: string; lom: string; mode: '現地' | 'ZOOM'; seat: string } | null>(null);
  const [mode, setMode] = useState<'現地' | 'ZOOM'>('現地');
  const [specificSeatInput, setSpecificSeatInput] = useState('');
  const [hasOmiyage, setHasOmiyage] = useState(false);

  // 3. ÉTATS DE CORRECTION (Formulaire principal)
  const [editLastName, setEditLastName] = useState('');
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastNameKana, setEditLastNameKana] = useState('');
  const [editFirstNameKana, setEditFirstNameKana] = useState('');
  const [editLomKana, setEditLomKana] = useState('');

  // 4. ÉTATS DE LA MODALE OMIYAGE DÉTACHÉE
  const [showOmiyageModal, setShowOmiyageModal] = useState(false);
  const [omiSearch, setOmiSearch] = useState('');
  const [omiSelected, setOmiSelected] = useState<EnrichedParticipant | null>(null);
  const [omiShopInput, setOmiShopInput] = useState('');
  const [omiItemInput, setOmiItemInput] = useState('');

  // 4b. ÉTAT DE LA MODALE DE PURGE (dangereux — utilisé pour nettoyer les données de test)
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearConfirmText, setClearConfirmText] = useState('');

  // 5. ÉTATS DU MODE SUPERVISION (Édition en ligne)
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [supervisionSearch, setSupervisionSearch] = useState('');
  const [supervisionForm, setSupervisionForm] = useState<Partial<EnrichedParticipant>>({});

  // 6. ÉTAT DE LA MODALE D'IMPRESSION (PRÉVISUALISATION)
  const [printPreview, setPrintPreview] = useState<{ title: string, html: string } | null>(null);

  // ---------------- PROTOCOLE DE PLACEMENT ----------------
  // Numérotation simple, sans préfixe de rangée (pas de "A-01" — juste "1", "2", "3"...),
  // cohérente avec le format utilisé pour la Summer Con.
  const ALL_SEATS = useMemo(() => {
    const seats: string[] = [];
    for (let i = 1; i <= 2000; i++) seats.push(String(i));
    return seats;
  }, []);

  const fetchRoster = async () => {
    const { data: participantsData, error: pError } = await supabase
      .from('participants')
      .select(`*, loms ( name, name_kana, sort_priority, block, region )`)
      .eq('mandate_year', activeYear);

    if (pError) {
      console.error(pError);
      return;
    }
    setRoster((participantsData || []) as Participant[]);

    if (activeMeeting) {
      const { data: attData, error: aError } = await supabase
        .from('attendances')
        .select('*')
        .eq('meeting_id', activeMeeting.id);

      if (aError) {
        console.error(aError);
        setAttendanceMap({});
        return;
      }
      const map: Record<string, Attendance> = {};
      (attData || []).forEach((a: Attendance) => { map[a.participant_id] = a; });
      setAttendanceMap(map);

      // 座席プランのうち、個人名を伴わない理事長ルールを取得する（列Aが空＝当日飛び入り用、
      // またはブロック／地区指定＝個人未定のロック済みゾーン）。
      const { data: poolData, error: poolError } = await supabase
        .from('seat_plan_rules')
        .select('role, target_type, target_name, start_seat, end_seat')
        .eq('meeting_id', activeMeeting.id)
        .eq('role', 'PRESIDENT')
        .in('target_type', ['NONE', 'BLOCK_DISTRICT']);

      const expandToNums = (rows: any[]): number[] => {
        const nums = rows.flatMap((r: any) => {
          const s = parseInt(r.start_seat, 10);
          const e = r.end_seat ? parseInt(r.end_seat, 10) : s;
          if (isNaN(s)) return [];
          const list: number[] = [];
          for (let i = s; i <= (isNaN(e) || e < s ? s : e); i++) list.push(i);
          return list;
        });
        return Array.from(new Set(nums)).sort((a: number, b: number) => a - b);
      };

      if (!poolError && poolData) {
        const rows = poolData as any[];
        setWalkInPresidentPool(expandToNums(rows.filter(r => r.target_type === 'NONE')));

        // ブロック／地区ごとに理事長用の確保座席をまとめる（未登録の理事長でも、
        // 自分のLOMが属するブロック／地区の確保ゾーンから自動で座席を得られるように）。
        const blockRows = rows.filter(r => r.target_type === 'BLOCK_DISTRICT');
        const byBlock: Record<string, number[]> = {};
        const blockNames = Array.from(new Set(blockRows.map(r => r.target_name).filter(Boolean)));
        blockNames.forEach(name => {
          byBlock[name] = expandToNums(blockRows.filter(r => r.target_name === name));
        });
        setBlockPresidentPools(byBlock);
      } else {
        setWalkInPresidentPool([]);
        setBlockPresidentPools({});
      }
    } else {
      setAttendanceMap({});
      setWalkInPresidentPool([]);
      setBlockPresidentPools({});
    }
  };

  useEffect(() => {
    fetchRoster();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeYear, activeMeeting]);

  // オンタブ切り替え時にも最新データを取得する（他のタブで受付した内容が
  // すぐ反映されるように）。
  useEffect(() => {
    fetchRoster();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // ---------------- SYNCHRONISATION MULTI-POSTE (TEMPS RÉEL) ----------------
  // Quand un autre poste d'accueil modifie une ligne d'émargement pour CETTE
  // réunion (check-in, annulation, import topologique...), on se resynchronise
  // automatiquement. Un léger anti-rebond évite de multiplier les requêtes si
  // plusieurs lignes changent d'un coup (ex: upload topologique en masse).
  // Nécessite que la table `attendances` soit ajoutée à la publication Realtime
  // de Supabase (voir migration_multi_poste.sql).
  useEffect(() => {
    if (!activeMeeting) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { fetchRoster(); }, 400);
    };

    const channel = supabase
      .channel(`attendances-meeting-${activeMeeting.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendances', filter: `meeting_id=eq.${activeMeeting.id}` },
        scheduleRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'seat_plan_rules', filter: `meeting_id=eq.${activeMeeting.id}` },
        scheduleRefresh
      )
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMeeting?.id]);

  const rosterWithAttendance = useMemo<EnrichedParticipant[]>(() => {
    return roster.map(p => {
      const a = attendanceMap[p.id];
      return {
        ...p,
        checked_in: a?.checked_in || false,
        participation_mode: (a?.participation_mode as '現地' | 'ZOOM') || '現地',
        has_omiyage: a?.has_omiyage || false,
        omiyage_shop: a?.omiyage_shop || null,
        omiyage_item: a?.omiyage_item || null,
        assigned_seat: a?.assigned_seat || null,
      };
    });
  }, [roster, attendanceMap]);

  // ---------------- MOTEURS DE RECHERCHE ----------------
  const candidates = useMemo(() => {
    if (appliedSearch.trim().length < 1) return [];
    const term = appliedSearch.toLowerCase().replace(/[\s ]+/g, '');
    return rosterWithAttendance.filter(p => {
      const text = (p.last_name + p.first_name + p.last_name_kana + p.first_name_kana + (p.loms?.name||'') + (p.loms?.name_kana||'') + (p.auth_id||'')).toLowerCase();
      return text.includes(term);
    }).slice(0, 10);
  }, [appliedSearch, rosterWithAttendance]);

  const omiCandidates = useMemo(() => {
    if (omiSearch.trim().length < 1) return [];
    const term = omiSearch.toLowerCase().replace(/[\s ]+/g, '');
    return rosterWithAttendance.filter(p => p.checked_in).filter(p => {
      const text = ((p.loms?.name||'') + p.last_name + p.first_name + (p.auth_id||'')).toLowerCase();
      return text.includes(term);
    }).slice(0, 5);
  }, [omiSearch, rosterWithAttendance]);

  // --- DOUBLE TRI HYBRIDE : PRÉSÉANCE DU LOM + ALIGNEMENT DES SIÈGES (NUMÉRIQUE) ---
  const checkedInMembers = useMemo(() => {
    return rosterWithAttendance
      .filter(p => p.checked_in)
      .sort((a, b) => {
        const seatA = (a.assigned_seat || 'ZZZ').toUpperCase();
        const seatB = (b.assigned_seat || 'ZZZ').toUpperCase();

        if (seatA === 'DISTANCIEL' && seatB !== 'DISTANCIEL') return 1;
        if (seatB === 'DISTANCIEL' && seatA !== 'DISTANCIEL') return -1;

        const priorA = a.loms?.sort_priority ?? 50;
        const priorB = b.loms?.sort_priority ?? 50;
        if (priorA !== priorB) {
          return priorA - priorB;
        }

        return compareSeats(seatA, seatB);
      });
  }, [rosterWithAttendance]);

  // Filtre d'affichage pour l'onglet Kanri uniquement (recherche parmi les présents).
  // N'affecte ni le compteur d'onglet, ni les listes imprimées, qui restent sur checkedInMembers.
  const supervisionMembers = useMemo(() => {
    if (!supervisionSearch.trim()) return checkedInMembers;
    const term = supervisionSearch.toLowerCase().replace(/[\s ]+/g, '');
    return checkedInMembers.filter(p => {
      const text = (p.last_name + p.first_name + p.last_name_kana + p.first_name_kana + (p.loms?.name||'') + (p.loms?.name_kana||'') + (p.auth_id||'')).toLowerCase();
      return text.includes(term);
    });
  }, [checkedInMembers, supervisionSearch]);

  // ---------------- ACTIONS D'ACCUEIL ----------------
  const handleSelect = (p: EnrichedParticipant) => {
    setSelectedParticipant(p);
    setMode(p.participation_mode === 'ZOOM' ? 'ZOOM' : '現地');
    setHasOmiyage(p.has_omiyage);
    setSpecificSeatInput(p.assigned_seat || '');
    setEditLastName(p.last_name);
    setEditFirstName(p.first_name);
    setEditLastNameKana(p.last_name_kana || '');
    setEditFirstNameKana(p.first_name_kana || '');
    setEditLomKana(p.loms?.name_kana || '');
  };

  const executeCheckIn = async () => {
    if (!selectedParticipant || !activeMeeting) return;
    setLoading(true);

    const isSeatedMeeting = activeMeeting.seating_strategy === 'KYOTO_FIXED' || activeMeeting.seating_strategy === 'SUMMER_CON';

    let finalSeat: string;
    if (mode === 'ZOOM') {
      finalSeat = 'Distanciel';
    } else if (isSeatedMeeting && specificSeatInput.trim()) {
      // 事前にトポロジーで確保されていた座席（LOM名／ブロック確保）はそのまま使う。
      finalSeat = specificSeatInput.trim().toUpperCase();
    } else {
      // 当日飛び入りの空席探し：ボタンを押したこの瞬間に、サーバーへ直接問い合わせて
      // 最新の予約状況を取得する。ローカルにキャッシュされた状態には一切頼らない —
      // 複数端末が同時に検索・選択していても、書き込み直前の最新状態だけを見て決める。
      try {
        const { data: freshAttendances, error: freshError } = await supabase
          .from('attendances')
          .select('assigned_seat')
          .eq('meeting_id', activeMeeting.id)
          .not('assigned_seat', 'is', null);
        if (freshError) throw freshError;

        const freshReserved = new Set((freshAttendances || []).map((a: any) => (a.assigned_seat || '').toUpperCase()));

        let pool: string[];
        if (isSeatedMeeting && activeMeeting.seating_strategy === 'SUMMER_CON') {
          const block = selectedParticipant.loms?.block;
          const region = selectedParticipant.loms?.region;
          const blockPool = (block && blockPresidentPools[block]) || (region && blockPresidentPools[region]) || null;
          pool = (blockPool ? blockPool : walkInPresidentPool).map(n => String(n));
        } else {
          pool = ALL_SEATS;
        }
        finalSeat = pool.find(seat => !freshReserved.has(seat)) || '満席';
      } catch (err: any) {
        alert(`座席の確認に失敗しました： ${err.message}`);
        setLoading(false);
        return;
      }
    }

    const attendancePayload = {
      meeting_id: activeMeeting.id,
      participant_id: selectedParticipant.id,
      checked_in: true,
      participation_mode: mode,
      has_omiyage: hasOmiyage,
      omiyage_shop: hasOmiyage ? (selectedParticipant.omiyage_shop || null) : null,
      omiyage_item: hasOmiyage ? (selectedParticipant.omiyage_item || null) : null,
      assigned_seat: finalSeat,
    };

    const participantPayload = {
      last_name: editLastName,
      first_name: editFirstName,
      last_name_kana: editLastNameKana,
      first_name_kana: editFirstNameKana,
    };

    try {
      if (selectedParticipant.lom_id && editLomKana !== selectedParticipant.loms?.name_kana) {
        await supabase.from('loms').update({ name_kana: editLomKana }).eq('id', selectedParticipant.lom_id);
      }

      const { error: pError } = await supabase.from('participants').update(participantPayload).eq('id', selectedParticipant.id);
      if (pError) throw pError;

      const { error: aError } = await supabase
        .from('attendances')
        .upsert(attendancePayload, { onConflict: 'meeting_id, participant_id' });

      if (aError) {
        // 23505 = violation de contrainte unique (meeting_id, assigned_seat) : un autre
        // poste d'accueil vient de prendre ce siège au même moment.
        if (aError.code === '23505') {
          await fetchRoster();
          throw new Error(`座席「${finalSeat}」は直前に他の端末で使用されました。最新の空席を反映しましたので、もう一度「受付を確定」を押してください。`);
        }
        throw aError;
      }

      await fetchRoster();

      // 座席はここで確定済み（DBへの書き込み成功後）。ポップアップにはこの
      // 確定値のみを表示する — 書き込み前の「見込み」を見せることは絶対にしない。
      setCheckinResult({
        name: `${selectedParticipant.last_name} ${selectedParticipant.first_name}`,
        lom: selectedParticipant.loms?.name || '',
        mode,
        seat: finalSeat,
      });

      setSelectedParticipant(null);
      setSearchInput('');
      setAppliedSearch('');
      setSpecificSeatInput('');
    } catch (err: any) {
      alert(`エラー： ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ---------------- ACTIONS OMIYAGE MODAL ----------------
  const handleOmiSelect = (p: EnrichedParticipant) => {
    setOmiSelected(p);
    setOmiShopInput(p.omiyage_shop || '');
    setOmiItemInput(p.omiyage_item || '');
  };

  const executeOmiyageSave = async () => {
    if (!omiSelected || !activeMeeting) return;
    setLoading(true);
    const payload = { has_omiyage: true, omiyage_shop: omiShopInput, omiyage_item: omiItemInput };
    const { error } = await supabase
      .from('attendances')
      .update(payload)
      .eq('meeting_id', activeMeeting.id)
      .eq('participant_id', omiSelected.id);
    setLoading(false);
    if (error) { alert(error.message); } else { await fetchRoster(); setShowOmiyageModal(false); setOmiSelected(null); setOmiSearch(''); }
  };

  // ---------------- ACTIONS SUPERVISION & ANNULATION ----------------
  const handleSupervisionSave = async () => {
    if (!editingRowId || !activeMeeting) return;

    const { last_name, first_name, last_name_kana, first_name_kana, participation_mode, assigned_seat, has_omiyage, omiyage_shop, omiyage_item } = supervisionForm;

    const participantPayload: Record<string, any> = {};
    if (last_name !== undefined) participantPayload.last_name = last_name;
    if (first_name !== undefined) participantPayload.first_name = first_name;
    if (last_name_kana !== undefined) participantPayload.last_name_kana = last_name_kana;
    if (first_name_kana !== undefined) participantPayload.first_name_kana = first_name_kana;

    const attendancePayload: Record<string, any> = {};
    if (participation_mode !== undefined) attendancePayload.participation_mode = participation_mode;
    if (assigned_seat !== undefined) attendancePayload.assigned_seat = assigned_seat;
    if (has_omiyage !== undefined) {
      attendancePayload.has_omiyage = has_omiyage;
      attendancePayload.omiyage_shop = has_omiyage ? (omiyage_shop || null) : null;
      attendancePayload.omiyage_item = has_omiyage ? (omiyage_item || null) : null;
    }

    try {
      if (Object.keys(participantPayload).length > 0) {
        const { error } = await supabase.from('participants').update(participantPayload).eq('id', editingRowId);
        if (error) throw error;
      }
      if (Object.keys(attendancePayload).length > 0) {
        const { error } = await supabase
          .from('attendances')
          .update(attendancePayload)
          .eq('meeting_id', activeMeeting.id)
          .eq('participant_id', editingRowId);
        if (error) {
          if (error.code === '23505') {
            throw new Error(`座席「${assigned_seat}」は既に他の参加者に割り当てられています。別の座席を指定してください。`);
          }
          throw error;
        }
      }
      setEditingRowId(null);
      fetchRoster();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleCancelCheckIn = async (p: EnrichedParticipant) => {
    const confirmation = window.confirm(`⚠️ ${p.last_name} ${p.first_name} の受付を取り消します。よろしいですか？`);
    if (!confirmation || !activeMeeting) return;

    setLoading(true);
    // 受付状態のみ解除する（DELETEはしない）。座席（assigned_seat）は事前に取り込んだ
    // 座席配置なので保持する。再度受付する際にこの席が自動で復元される。
    const { error } = await supabase
      .from('attendances')
      .update({ checked_in: false, has_omiyage: false, omiyage_shop: null, omiyage_item: null })
      .eq('meeting_id', activeMeeting.id)
      .eq('participant_id', p.id);
    setLoading(false);
    if (error) { alert(`エラー： ${error.message}`); } else { fetchRoster(); }
  };

  // ---------------- PURGE (テストデータのリセット用) ----------------
  // このミーティングの受付データ（attendances）と座席プラン（seat_plan_rules）のみを削除する。
  // 参加者名簿（participants）やLOM情報は一切削除しない。
  const handleClearMeetingData = async () => {
    if (!activeMeeting || clearConfirmText !== '削除') return;
    setLoading(true);
    try {
      const { error: attError } = await supabase.from('attendances').delete().eq('meeting_id', activeMeeting.id);
      if (attError) throw attError;
      const { error: planError } = await supabase.from('seat_plan_rules').delete().eq('meeting_id', activeMeeting.id);
      if (planError) throw planError;

      setShowClearModal(false);
      setClearConfirmText('');
      await fetchRoster();
      alert('このミーティングの受付データと座席プランを削除しました。');
    } catch (err: any) {
      alert(`削除に失敗しました： ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ---------------- MOTEURS DE GÉNÉRATION D'IMPRESSION ----------------
  // 配列を指定サイズごとに分割する（印刷ページ分割用）
  const chunkArray = (arr: EnrichedParticipant[], size: number): EnrichedParticipant[][] => {
    const chunks: EnrichedParticipant[][] = [];
    for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
    return chunks;
  };

  const generateObserversHtml = () => {
    if (checkedInMembers.length === 0) return `<p style="text-align:center; color:#64748b; font-style: italic;">Aucun observateur enregistré.</p>`;

    // ふりがな行と氏名行のペアがページをまたいで分断されないよう、ページごとに
    // 別々のテーブルとして出力し、テーブル間に明示的な改ページを入れる。
    const ROWS_PER_PAGE = 13;
    const pages = chunkArray(checkedInMembers, ROWS_PER_PAGE);

    const tables = pages.map((page, pageIndex) => {
      const rows = page.map(p => `
        <tr style="background-color: #c9daf8; font-size: 11px; page-break-inside: avoid;">
          <td style="border: 1px solid #000; padding: 4px 8px; text-align: center; width: 35%;">${p.loms?.name_kana || ''}</td>
          <td style="border: 1px solid #000; padding: 4px; text-align: center; width: 15%;"></td>
          <td style="border: 1px solid #000; padding: 4px 12px; text-align: left; width: 40%;">${p.last_name_kana} ${p.first_name_kana}</td>
          <td style="border: 1px solid #000; padding: 4px; text-align: center; width: 10%;"></td>
        </tr>
        <tr style="font-size: 15px; page-break-inside: avoid;">
          <td style="border: 1px solid #000; padding: 8px; text-align: center; font-weight: bold;">${p.loms?.name || '—'}</td>
          <td style="border: 1px solid #000; padding: 8px; text-align: center;">理事長</td>
          <td style="border: 1px solid #000; padding: 8px 12px; text-align: left; font-weight: bold;">${p.last_name} ${p.first_name}</td>
          <td style="border: 1px solid #000; padding: 8px; text-align: center;">君</td>
        </tr>
      `).join('');

      const isLastPage = pageIndex === pages.length - 1;
      return `
        <table style="width: 100%; border-collapse: collapse; border: 2px solid #000; font-family: 'Meiryo', 'Yu Gothic', sans-serif; margin-bottom: 32px; ${isLastPage ? '' : 'page-break-after: always;'}">
          <tbody>${rows}</tbody>
        </table>
      `;
    }).join('');

    return `
      <p style="text-align: center; font-size: 14px; line-height: 1.9; margin-bottom: 16px; font-family: 'Meiryo', 'Yu Gothic', sans-serif;">
        それでは、開会までに受付をされましたオブザーブの理事長の皆様をご紹介させていただきます。<br/>
        なお、法人格名の呼称は割愛させていただきます。また、時間の都合上、拍手は最後に一括でお願いいたします。
      </p>
      ${tables}
      <p style="text-align: center; font-size: 15px; font-weight: bold; font-family: 'Meiryo', 'Yu Gothic', sans-serif; letter-spacing: 0.5px; margin-top: 24px; line-height: 2;">
        以上、開会までに受付をお済になられました理事長の皆様のご紹介とさせていただきます。<br/>
        改めましてオブザーブいただきました理事長の皆様に盛大な拍手をお願いいたします。<br/>
        オブザーバー紹介は以上となります。<br/>
        また、お土産も数多くいただいておりますので、ご紹介させていただきます。
      </p>
    `;
  };

  const generateOmiyageHtml = () => {
    const omiyages = checkedInMembers.filter(p => p.has_omiyage);
    if (omiyages.length === 0) return `<p style="text-align:center; color:#64748b; font-style: italic; font-size: 18px;">Aucun Omiyage enregistré pour le moment.</p>`;

    // お土産情報の行が1つ多い分、1ページあたりの人数を少なめにする。
    const ROWS_PER_PAGE = 9;
    const pages = chunkArray(omiyages, ROWS_PER_PAGE);

    const tables = pages.map((page, pageIndex) => {
      const rows = page.map(p => `
        <tr style="background-color: #c9daf8; font-size: 11px; page-break-inside: avoid;">
          <td style="border: 1px solid #000; padding: 4px 8px; text-align: center; width: 35%;">${p.loms?.name_kana || ''}</td>
          <td style="border: 1px solid #000; padding: 4px; text-align: center; width: 15%;"></td>
          <td style="border: 1px solid #000; padding: 4px 12px; text-align: left; width: 40%;">${p.last_name_kana} ${p.first_name_kana}</td>
          <td style="border: 1px solid #000; padding: 4px; text-align: center; width: 10%;"></td>
        </tr>
        <tr style="font-size: 15px; page-break-inside: avoid;">
          <td style="border: 1px solid #000; padding: 8px; text-align: center; font-weight: bold;">${p.loms?.name || '—'}</td>
          <td style="border: 1px solid #000; padding: 8px; text-align: center;">理事長</td>
          <td style="border: 1px solid #000; padding: 8px 12px; text-align: left; font-weight: bold;">${p.last_name} ${p.first_name}</td>
          <td style="border: 1px solid #000; padding: 8px; text-align: center;">君</td>
        </tr>
        <tr style="font-size: 16px; page-break-inside: avoid;">
          <td colspan="4" style="border: 1px solid #000; padding: 12px; text-align: center; line-height: 1.6;">
            より ${p.omiyage_shop || '—'} さんの<br/>
            ${p.omiyage_item || '—'} を頂戴しております。
          </td>
        </tr>
      `).join('');

      const isLastPage = pageIndex === pages.length - 1;
      return `
        <table style="width: 100%; border-collapse: collapse; border: 2px solid #000; font-family: 'Meiryo', 'Yu Gothic', sans-serif; margin-bottom: 32px; ${isLastPage ? '' : 'page-break-after: always;'}">
          <tbody>${rows}</tbody>
        </table>
      `;
    }).join('');

    return `
      <h1 style="text-align: center; font-size: 20px; color: #0f172a; margin-bottom: 20px; font-family: 'Meiryo', 'Yu Gothic', sans-serif;">お土産 披露リスト</h1>
      ${tables}
      <p style="text-align: center; font-size: 15px; font-weight: bold; font-family: 'Meiryo', 'Yu Gothic', sans-serif; letter-spacing: 0.5px; margin-top: 24px; line-height: 2;">
        以上となります。<br/>
        ありがとうございました。
      </p>
    `;
  };

  const handlePrintDocument = () => {
    if (!printPreview) return;
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <head>
            <title> </title>
            <style>
              body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 40px; color: #0f172a; }
              table, tr, td {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
                border-collapse: collapse !important;
              }
              @media print {
                body { padding: 0; }
                @page { margin: 1cm; }
                table, tr, td {
                  -webkit-print-color-adjust: exact !important;
                  print-color-adjust: exact !important;
                }
              }
            </style>
          </head>
          <body>
            ${printPreview.html}
            <script>
              setTimeout(() => { window.print(); window.close(); }, 300);
            </script>
          </body>
        </html>
      `);
      printWindow.document.close();
    }
  };

  // BOUCLIER DE SÉCURITÉ
  if (!activeMeeting) {
    return (
      <div style={{ backgroundColor: '#fff', padding: '40px', borderRadius: '16px', border: '1px solid #e2e8f0', textAlign: 'center', color: '#64748b' }}>
        会議が選択されていません。ダッシュボードから会議を選択してください。
      </div>
    );
  }

  const isSeatedMeeting = activeMeeting.seating_strategy === 'KYOTO_FIXED' || activeMeeting.seating_strategy === 'SUMMER_CON';

  const tabButton = (
    key: 'CHECKIN' | 'SUPERVISION' | 'YOMIAGE' | 'OMIYAGE_LIST' | 'SEATMAP',
    label: string
  ) => (
    <button
      onClick={() => setActiveTab(key)}
      style={{
        padding: '10px 20px',
        border: 'none',
        borderRadius: '6px 6px 0 0',
        fontWeight: 700,
        fontSize: '13px',
        cursor: 'pointer',
        transition: 'background-color 0.15s, color 0.15s',
        backgroundColor: activeTab === key ? '#00A3E0' : 'transparent',
        color: activeTab === key ? '#fff' : '#00A3E0',
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ maxWidth: '1240px', width: '100%', margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 200px', gap: '20px', alignItems: 'start', overflowX: 'hidden' }}>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', minWidth: 0 }}>

        {/* ---------------- BARRE D'ONGLETS (style Windows) ---------------- */}
        <div style={{ display: 'flex', gap: '2px', borderBottom: '2px solid #00A3E0', flexWrap: 'wrap' }}>
          {tabButton('CHECKIN', '受付モード')}
          {tabButton('SUPERVISION', `管理（${checkedInMembers.length}）`)}
          {tabButton('YOMIAGE', '読み上げ表')}
          {tabButton('OMIYAGE_LIST', 'お土産管理簿')}
          {tabButton('SEATMAP', '座席マップ')}
        </div>

        {/* ---------------- CONTENU DE L'ONGLET : taille figée (largeur ET hauteur), défilement interne uniquement ---------------- */}
        {/* Ce bloc ne change JAMAIS de taille en changeant d'onglet — tout débordement
            (tableau large, tableau long...) défile À L'INTÉRIEUR, jamais la page elle-même. */}
        <div style={{ width: '100%', minWidth: 0, height: '720px', overflow: 'auto' }}>

      {/* ---------------- VUE 1 : MODE ACCUEIL (Radar + Formulaire) ---------------- */}
      {activeTab === 'CHECKIN' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '24px' }}>

          <div style={{ backgroundColor: '#fff', padding: '24px', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', color: '#0B1F3A' }}>理事長検索</h3>
            <form onSubmit={e => { e.preventDefault(); setAppliedSearch(searchInput); setSelectedParticipant(null); }} style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
              <input type="text" placeholder="例：氏名、LOM名、認証番号" style={inputStyle} value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
              <button type="submit" style={{ padding: '0 16px', borderRadius: '8px', border: 'none', backgroundColor: '#f1f5f9', fontWeight: 'bold', cursor: 'pointer' }}>検索</button>
            </form>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {candidates.map(c => (
                <button key={c.id} onClick={() => handleSelect(c)} style={{ width: '100%', padding: '12px', borderRadius: '8px', textAlign: 'left', cursor: 'pointer', border: selectedParticipant?.id === c.id ? '2px solid #00A3E0' : '1px solid #e2e8f0', backgroundColor: selectedParticipant?.id === c.id ? '#f0f9ff' : '#fff' }}>
                  <span style={{ fontSize: '10px', display: 'block', color: '#64748b', fontWeight: 'bold' }}>{c.loms?.name} — {c.auth_id}</span>
                  <strong style={{ fontSize: '15px', color: '#0B1F3A' }}>{c.last_name} {c.first_name}</strong>
                  {c.checked_in && <span style={{ float: 'right', fontSize: '10px', backgroundColor: '#dcfce7', color: '#16a34a', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>{c.assigned_seat}</span>}
                </button>
              ))}
            </div>
          </div>

          <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
            {selectedParticipant ? (
              <form onSubmit={e => { e.preventDefault(); executeCheckIn(); }}>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '10px 16px', backgroundColor: '#f0f9ff', borderRadius: '10px', marginBottom: '12px', border: '1px solid #bae6fd' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '16px', fontWeight: '800', color: '#0369a1', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedParticipant.loms?.name}</div>
                    <div style={{ fontSize: '11px', color: '#0284c7', marginTop: '2px' }}>{editLomKana || selectedParticipant.loms?.name_kana || '—'}</div>
                  </div>
                  {(selectedParticipant.loms?.block || selectedParticipant.loms?.region) && (
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#0284c7', backgroundColor: '#e0f2fe', padding: '4px 10px', borderRadius: '999px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {selectedParticipant.loms?.block}{selectedParticipant.loms?.region ? ` ・ ${selectedParticipant.loms?.region}` : ''}
                    </div>
                  )}
                </div>

                <h2 style={{ margin: '0 0 10px 0', fontSize: '15px', fontWeight: 900, color: '#0B1F3A' }}>受付情報</h2>

                <div style={{ backgroundColor: '#f8fafc', padding: '12px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '10px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div><label style={labelStyle}>姓</label><input type="text" style={inputStyle} value={editLastName} onChange={e => setEditLastName(e.target.value)} /></div>
                    <div><label style={labelStyle}>名</label><input type="text" style={inputStyle} value={editFirstName} onChange={e => setEditFirstName(e.target.value)} /></div>
                    <div><label style={labelStyle}>ふりがな（姓）</label><input type="text" style={inputStyle} value={editLastNameKana} onChange={e => setEditLastNameKana(e.target.value)} /></div>
                    <div><label style={labelStyle}>ふりがな（名）</label><input type="text" style={inputStyle} value={editFirstNameKana} onChange={e => setEditFirstNameKana(e.target.value)} /></div>
                    <div style={{ gridColumn: 'span 2' }}><label style={{...labelStyle, color:'#00A3E0'}}>所属LOM ふりがな</label><input type="text" style={{...inputStyle, borderColor: '#bae6fd', backgroundColor: '#f0f9ff'}} value={editLomKana} onChange={e => setEditLomKana(e.target.value)} /></div>
                  </div>
                </div>

                <div style={{ backgroundColor: '#f8fafc', padding: '12px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '10px' }}>
                  <label style={labelStyle}>参加形式</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="button" onClick={() => setMode('現地')} style={{ flex: 1, padding: '8px', borderRadius: '8px', border: mode === '現地' ? '2px solid #10b981' : '1px solid #cbd5e1', fontWeight: 'bold', backgroundColor: mode === '現地' ? '#f0fdf4' : '#fff', color: mode === '現地' ? '#16a34a' : '#475569' }}>現地</button>
                    <button type="button" onClick={() => setMode('ZOOM')} style={{ flex: 1, padding: '8px', borderRadius: '8px', border: mode === 'ZOOM' ? '2px solid #00A3E0' : '1px solid #cbd5e1', fontWeight: 'bold', backgroundColor: mode === 'ZOOM' ? '#f0f9ff' : '#fff', color: mode === 'ZOOM' ? '#00A3E0' : '#475569' }}>Zoom</button>
                  </div>
                  {isSeatedMeeting && mode === '現地' && (
                    <p style={{ fontSize: '11px', margin: '10px 0 0 0', color: '#64748b' }}>
                      座席はシステムが自動的に割り当てます。
                    </p>
                  )}
                </div>

                <div style={{ padding: '10px 14px', borderRadius: '12px', border: '1px solid #e2e8f0', backgroundColor: hasOmiyage ? '#fffbeb' : '#fff' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontWeight: 'bold', color: '#d97706', fontSize: '13px' }}>
                    <input type="checkbox" checked={hasOmiyage} onChange={(e) => setHasOmiyage(e.target.checked)} style={{ width: '16px', height: '16px' }} />
                    お土産の申告（詳細は後で入力可）
                  </label>
                </div>

                <button type="submit" style={{ width: '100%', padding: '12px', borderRadius: '10px', border: 'none', backgroundColor: '#00A3E0', color: '#fff', fontWeight: '900', fontSize: '15px', cursor: 'pointer', marginTop: '12px' }}>受付を確定</button>
              </form>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8' }}>左のリストから理事長を選択してください。</div>
            )}
          </div>
        </div>
      )}

      {/* ---------------- VUE 2 : MODE SUPERVISION (Tableau d'édition) ---------------- */}
      {activeTab === 'SUPERVISION' && (
        <div style={{ backgroundColor: '#fff', padding: '24px', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', color: '#0B1F3A' }}>座席・情報の管理</h3>
          <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '16px' }}>座席の割り当てや氏名の表記をこの画面から直接修正できます。表示順は席次に従います。</p>

          <input
            type="text"
            placeholder="氏名、LOM名、認証番号で絞り込み..."
            value={supervisionSearch}
            onChange={(e) => setSupervisionSearch(e.target.value)}
            style={{ ...inputStyle, marginBottom: '16px', maxWidth: '360px' }}
          />

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569' }}>
                  <th style={{ padding: '12px' }}>LOM</th>
                  <th style={{ padding: '12px' }}>氏名</th>
                  <th style={{ padding: '12px' }}>参加形式</th>
                  <th style={{ padding: '12px' }}>座席</th>
                  <th style={{ padding: '12px', textAlign: 'center' }}>お土産</th>
                  <th style={{ padding: '12px', textAlign: 'center' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {supervisionMembers.map(p => {
                  const isEditing = editingRowId === p.id;
                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '12px', fontWeight: 'bold', color: '#0B1F3A' }}>{p.loms?.name}</td>
                      <td style={{ padding: '12px' }}>
                        {isEditing ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <div style={{ display: 'flex', gap: '4px' }}>
                              <input placeholder="姓" style={{...inputStyle, padding: '4px'}} value={supervisionForm.last_name||''} onChange={e=>setSupervisionForm({...supervisionForm, last_name: e.target.value})} />
                              <input placeholder="名" style={{...inputStyle, padding: '4px'}} value={supervisionForm.first_name||''} onChange={e=>setSupervisionForm({...supervisionForm, first_name: e.target.value})} />
                            </div>
                            <div style={{ display: 'flex', gap: '4px' }}>
                              <input placeholder="せい" style={{...inputStyle, padding: '4px', fontSize: '11px'}} value={supervisionForm.last_name_kana||''} onChange={e=>setSupervisionForm({...supervisionForm, last_name_kana: e.target.value})} />
                              <input placeholder="めい" style={{...inputStyle, padding: '4px', fontSize: '11px'}} value={supervisionForm.first_name_kana||''} onChange={e=>setSupervisionForm({...supervisionForm, first_name_kana: e.target.value})} />
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div>{p.last_name} {p.first_name}</div>
                            <div style={{ fontSize: '11px', color: '#94a3b8' }}>{p.last_name_kana} {p.first_name_kana}</div>
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px' }}>
                        {isEditing ? (
                          <select style={{...inputStyle, padding: '4px'}} value={supervisionForm.participation_mode} onChange={e=>setSupervisionForm({...supervisionForm, participation_mode: e.target.value as any})}>
                            <option value="現地">現地</option>
                            <option value="ZOOM">Zoom</option>
                          </select>
                        ) : (p.participation_mode === 'ZOOM' ? 'Zoom' : '現地')}
                      </td>
                      <td style={{ padding: '12px' }}>
                        {isEditing ? (
                          <input style={{...inputStyle, padding: '4px', borderColor: '#38bdf8'}} value={supervisionForm.assigned_seat||''} onChange={e=>setSupervisionForm({...supervisionForm, assigned_seat: e.target.value})} />
                        ) : (
                          <span style={{ backgroundColor: '#dcfce7', color: '#16a34a', padding: '4px 8px', borderRadius: '4px', fontWeight: 'bold' }}>{p.assigned_seat}</span>
                        )}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center', fontSize: '16px' }}>
                        {isEditing ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 'bold', color: '#d97706', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={supervisionForm.has_omiyage || false}
                                onChange={e => setSupervisionForm({ ...supervisionForm, has_omiyage: e.target.checked })}
                              />
                              お土産あり
                            </label>
                            {supervisionForm.has_omiyage && (
                              <>
                                <input placeholder="お店" style={{ ...inputStyle, padding: '4px', fontSize: '11px' }} value={supervisionForm.omiyage_shop || ''} onChange={e => setSupervisionForm({ ...supervisionForm, omiyage_shop: e.target.value })} />
                                <input placeholder="品名" style={{ ...inputStyle, padding: '4px', fontSize: '11px' }} value={supervisionForm.omiyage_item || ''} onChange={e => setSupervisionForm({ ...supervisionForm, omiyage_item: e.target.value })} />
                              </>
                            )}
                          </div>
                        ) : (
                          p.has_omiyage ? <span title={p.omiyage_shop ? `${p.omiyage_shop} - ${p.omiyage_item}` : '詳細未入力'}>✅</span> : <span style={{ opacity: 0.3 }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        {isEditing ? (
                          <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                            <button onClick={handleSupervisionSave} style={{ padding: '6px', backgroundColor: '#10b981', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}><Check size={14}/></button>
                            <button onClick={() => setEditingRowId(null)} style={{ padding: '6px', backgroundColor: '#ef4444', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}><X size={14}/></button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                            <button onClick={() => { setEditingRowId(p.id); setSupervisionForm(p); }} style={{ padding: '6px 12px', backgroundColor: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
                              <Edit2 size={12} style={{ marginRight: '4px' }}/> 編集
                            </button>
                            <button onClick={() => handleCancelCheckIn(p)} style={{ padding: '6px 12px', backgroundColor: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center' }} title="受付を取消">
                              <RotateCcw size={12} style={{ marginRight: '4px' }}/> 取消
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {supervisionMembers.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', fontStyle: 'italic' }}>
                      {checkedInMembers.length === 0 ? 'まだ誰も受付されていません。' : '該当する参加者が見つかりません。'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------------- VUE 3 : 読み上げ表 ---------------- */}
      {activeTab === 'YOMIAGE' && (
        <YomiageList activeMeeting={activeMeeting} activeYear={activeYear} />
      )}

      {/* ---------------- VUE 4 : お土産管理簿 ---------------- */}
      {activeTab === 'OMIYAGE_LIST' && (
        <OmiyageList activeMeeting={activeMeeting} />
      )}

      {/* ---------------- VUE 5 : 座席マップ ---------------- */}
      {activeTab === 'SEATMAP' && (
        <SeatMap activeMeeting={activeMeeting} activeYear={activeYear} />
      )}

        </div>

      </div>

      {/* ---------------- COLONNE LATÉRALE : ACTIONS D'IMPRESSION ---------------- */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <button onClick={() => setPrintPreview({ title: 'プレビュー：オブザーバーリスト', html: generateObserversHtml() })} style={sidebarBtnStyle}><Users size={15}/> オブザーバーリスト印刷</button>
        <button onClick={() => setPrintPreview({ title: 'プレビュー：お土産リスト', html: generateOmiyageHtml() })} style={sidebarBtnStyle}><FileText size={15}/> お土産リスト印刷</button>
        <button onClick={() => setShowOmiyageModal(true)} style={sidebarBtnStyle}><Gift size={15}/> お土産クイック入力</button>

        <div style={{ borderTop: '1px solid #e2e8f0', margin: '8px 0' }} />

        <button
          onClick={() => setShowClearModal(true)}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 14px', backgroundColor: '#fff', color: '#ef4444', border: '1px solid #fca5a5', borderRadius: '8px', fontWeight: '700' as const, fontSize: '12px', cursor: 'pointer', textAlign: 'left' as const, width: '100%' }}
        >
          <Trash2 size={15}/> このミーティングのデータを削除
        </button>
      </div>

      {/* ---------------- MODALE : PURGE DES DONNÉES (dangereux) ---------------- */}
      {showClearModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(11, 31, 58, 0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000 }}>
          <div style={{ backgroundColor: '#fff', borderRadius: '16px', padding: '32px', width: '440px', border: '2px solid #ef4444' }}>
            <h3 style={{ margin: '0 0 16px 0', color: '#ef4444', fontSize: '18px', fontWeight: 900 }}>データ削除の確認</h3>
            <p style={{ fontSize: '13px', color: '#475569', lineHeight: 1.6, marginBottom: '16px' }}>
              このミーティング（{activeMeeting.location_name} ／ {activeMeeting.meeting_date}）の<strong>受付データ（チェックイン状況・座席）と座席プラン</strong>をすべて削除します。<br/>
              参加者名簿（Meibo）やLOM情報は削除されません。<br/>
              <strong style={{ color: '#ef4444' }}>この操作は取り消せません。</strong>
            </p>
            <label style={{ display: 'block', fontSize: '12px', color: '#64748b', marginBottom: '6px', fontWeight: 'bold' }}>
              確認のため「削除」と入力してください
            </label>
            <input
              type="text"
              value={clearConfirmText}
              onChange={e => setClearConfirmText(e.target.value)}
              style={{ ...inputStyle, marginBottom: '20px', borderColor: '#fca5a5' }}
              placeholder="削除"
            />
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={() => { setShowClearModal(false); setClearConfirmText(''); }} style={{ flex: 1, padding: '12px', backgroundColor: '#f1f5f9', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>キャンセル</button>
              <button
                onClick={handleClearMeetingData}
                disabled={clearConfirmText !== '削除' || loading}
                style={{ flex: 1, padding: '12px', backgroundColor: clearConfirmText === '削除' ? '#ef4444' : '#fca5a5', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: clearConfirmText === '削除' ? 'pointer' : 'not-allowed' }}
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- MODALE : GESTION OMIYAGE DÉTACHÉE ---------------- */}
      {showOmiyageModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(11, 31, 58, 0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
          <div style={{ backgroundColor: '#fff', borderRadius: '16px', padding: '32px', width: '500px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ margin: 0, fontSize: '20px', color: '#ea580c', display: 'flex', alignItems: 'center', gap: '8px' }}><Gift size={24}/> お土産詳細登録</h2>
              <button onClick={() => setShowOmiyageModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}><X size={24}/></button>
            </div>

            <label style={{ ...labelStyle, fontSize: '13px' }}>認証番号／LOM／氏名で検索</label>
            <input type="text" placeholder="例: 東京 / 田中" style={{ ...inputStyle, marginBottom: '16px', padding: '12px' }} value={omiSearch} onChange={e => { setOmiSearch(e.target.value); setOmiSelected(null); }} />

            {!omiSelected && omiCandidates.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '16px' }}>
                {omiCandidates.map(c => (
                  <button key={c.id} onClick={() => handleOmiSelect(c)} style={{ padding: '10px', textAlign: 'left', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', cursor: 'pointer' }}>
                    {c.loms?.name} — {c.last_name} {c.first_name}
                  </button>
                ))}
              </div>
            )}

            {omiSelected && (
              <div style={{ backgroundColor: '#fff7ed', padding: '16px', borderRadius: '8px', border: '1px solid #fed7aa', marginBottom: '24px' }}>
                <div style={{ fontWeight: 'bold', color: '#9a3412', marginBottom: '16px' }}>選択中：{omiSelected.loms?.name} {omiSelected.last_name}</div>
                <label style={labelStyle}>お店の名前</label>
                <input type="text" placeholder="例: かをり" style={{ ...inputStyle, marginBottom: '12px' }} value={omiShopInput} onChange={e => setOmiShopInput(e.target.value)} />
                <label style={labelStyle}>商品名</label>
                <input type="text" placeholder="例: レーズンサンド" style={inputStyle} value={omiItemInput} onChange={e => setOmiItemInput(e.target.value)} />
                <p style={{ fontSize: '11px', color: '#ef4444', marginTop: '8px' }}>※ 読み上げ表のために、()内にふりがなを入れてください</p>
              </div>
            )}

            <button onClick={executeOmiyageSave} disabled={!omiSelected || loading} style={{ width: '100%', padding: '16px', backgroundColor: omiSelected ? '#ea580c' : '#fca5a5', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '16px', cursor: omiSelected ? 'pointer' : 'not-allowed' }}>
              登録
            </button>
          </div>
        </div>
      )}

      {/* ---------------- MODALE : APERÇU & IMPRESSION DES RAPPORTS ---------------- */}
      {printPreview && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(11, 31, 58, 0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, backdropFilter: 'blur(6px)' }}>
          <div style={{ backgroundColor: '#fff', borderRadius: '16px', width: '800px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>
            <div style={{ padding: '20px 32px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: '18px', color: '#0B1F3A', fontWeight: '900' }}>📄 {printPreview.title}</h2>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button onClick={() => setPrintPreview(null)} style={{ padding: '10px 20px', backgroundColor: '#fff', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: 'bold', color: '#475569', cursor: 'pointer' }}>閉じる</button>
                <button onClick={handlePrintDocument} style={{ padding: '10px 24px', backgroundColor: '#0B1F3A', color: '#F5C842', border: 'none', borderRadius: '8px', fontWeight: '900', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>🖨️ 印刷</button>
              </div>
            </div>
            <div style={{ padding: '40px', overflowY: 'auto', backgroundColor: '#fff', flex: 1 }} dangerouslySetInnerHTML={{ __html: printPreview.html }} />
          </div>
        </div>
      )}

      {/* POPUP DE RÉSULTAT (受付完了) — n'apparaît qu'APRÈS l'écriture en base.
          Le siège affiché est donc définitif : pas de bouton retour/annuler ici. */}
      {checkinResult && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(11, 31, 58, 0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: '#fff', borderRadius: '16px', padding: '32px', width: '400px', textAlign: 'center' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: '#dcfce7', color: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: '24px', fontWeight: 900 }}>✓</div>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: 900, color: '#0f172a' }}>受付が完了しました</h3>
            <p style={{ fontSize: '16px', fontWeight: 'bold', color: '#0f172a' }}>{checkinResult.name}</p>
            <p style={{ fontSize: '13px', color: '#64748b', marginTop: '4px', marginBottom: '20px' }}>{checkinResult.lom}</p>

            {checkinResult.mode === 'ZOOM' ? (
              <div style={{ padding: '16px', borderRadius: '10px', backgroundColor: '#f0f9ff', color: '#0369a1', fontWeight: 900, fontSize: '16px' }}>
                Zoom参加
              </div>
            ) : checkinResult.seat && checkinResult.seat !== 'Distanciel' ? (
              <div>
                <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '6px' }}>座席番号</div>
                <div style={{ padding: '18px', borderRadius: '12px', backgroundColor: '#0B1F3A', color: '#F5C842', fontWeight: 900, fontSize: '32px', letterSpacing: '1px' }}>
                  {checkinResult.seat}
                </div>
              </div>
            ) : (
              <div style={{ padding: '16px', borderRadius: '10px', backgroundColor: '#f0fdf4', color: '#16a34a', fontWeight: 900, fontSize: '16px' }}>
                現地参加
              </div>
            )}

            <button
              onClick={() => setCheckinResult(null)}
              style={{ width: '100%', padding: '14px', marginTop: '24px', backgroundColor: '#00A3E0', color: '#fff', border: 'none', borderRadius: '10px', fontWeight: '900', fontSize: '15px', cursor: 'pointer' }}
            >
              閉じる
            </button>
          </div>
        </div>
      )}

    </div>
  );
};

const sidebarBtnStyle = { display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 14px', backgroundColor: '#00A3E0', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700' as const, fontSize: '12px', cursor: 'pointer', textAlign: 'left' as const, width: '100%' };
const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', color: '#334155', fontSize: '13px', boxSizing: 'border-box' as const, outline: 'none' };
const labelStyle = { display: 'block', fontSize: '11px', color: '#64748b', marginBottom: '4px', fontWeight: 'bold' as const };
