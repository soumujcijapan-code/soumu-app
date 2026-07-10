import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import type { Meeting, Participant, Attendance } from '../types';
import { Users, FileText, Gift, Edit2, Check, X, RotateCcw } from 'lucide-react';

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
  member_seat_range: string | null;
  lom_members_count: number;
};

// Calcule le sous-intervalle réellement occupé par les membres accompagnants, à partir
// de la zone brute réservée (ex: "119 ~ 166") et du nombre de membres déclaré à l'accueil.
// Ex: zone "119 ~ 166" + 5 membres → "119 ~ 123".
const computeMemberRangeDisplay = (rawRange: string | null, count: number): string | null => {
  if (!rawRange || !count || count <= 0) return null;
  const startToken = rawRange.split('~')[0].trim();
  const start = parseInt(startToken, 10);
  if (isNaN(start)) return rawRange; // format non numérique : on affiche la zone brute telle quelle
  const end = start + count - 1;
  return `${start} ~ ${end}`;
};

export const CheckInConsole: React.FC<Props> = ({ activeMeeting, activeYear }) => {
  // 1. ÉTATS GLOBAUX
  const [roster, setRoster] = useState<Participant[]>([]);
  const [attendanceMap, setAttendanceMap] = useState<Record<string, Attendance>>({});
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'CHECKIN' | 'SUPERVISION'>('CHECKIN');

  // 2. ÉTATS DU RADAR D'ACCUEIL
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [selectedParticipant, setSelectedParticipant] = useState<EnrichedParticipant | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [mode, setMode] = useState<'現地' | 'ZOOM'>('現地');
  const [specificSeatInput, setSpecificSeatInput] = useState('');
  const [hasOmiyage, setHasOmiyage] = useState(false);
  const [lomMembersCount, setLomMembersCount] = useState<number>(0);

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
    } else {
      setAttendanceMap({});
    }
  };

  useEffect(() => {
    fetchRoster();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeYear, activeMeeting]);

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
        member_seat_range: a?.member_seat_range || null,
        lom_members_count: a?.lom_members_count || 0,
      };
    });
  }, [roster, attendanceMap]);

  const occupiedSeats = useMemo(() => {
    const taken = new Set<string>();
    Object.values(attendanceMap).forEach(a => {
      if (a.checked_in && a.assigned_seat) {
        taken.add(a.assigned_seat.trim().toUpperCase());
      }
    });
    return taken;
  }, [attendanceMap]);

  const nextAutomaticSeat = useMemo(() => {
    return ALL_SEATS.find(seat => !occupiedSeats.has(seat)) || '満席';
  }, [ALL_SEATS, occupiedSeats]);

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

  // --- DOUBLE TRI HYBRIDE : PRÉSÉANCE DU LOM + ALIGNEMENT DES SIÈGES ---
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

        return seatA.localeCompare(seatB);
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
    setLomMembersCount(p.lom_members_count || 0);
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
    let finalSeat = mode === 'ZOOM' ? 'Distanciel' : (isSeatedMeeting && specificSeatInput.trim() ? specificSeatInput.trim().toUpperCase() : nextAutomaticSeat);

    const attendancePayload = {
      meeting_id: activeMeeting.id,
      participant_id: selectedParticipant.id,
      checked_in: true,
      participation_mode: mode,
      has_omiyage: hasOmiyage,
      omiyage_shop: hasOmiyage ? (selectedParticipant.omiyage_shop || null) : null,
      omiyage_item: hasOmiyage ? (selectedParticipant.omiyage_item || null) : null,
      assigned_seat: finalSeat,
      lom_members_count: activeMeeting.seating_strategy === 'SUMMER_CON' ? lomMembersCount : null
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
          setShowConfirm(false);
          throw new Error(`座席「${finalSeat}」は直前に他の端末で使用されました。最新の空席を反映しましたので、もう一度「確定」を押してください。`);
        }
        throw aError;
      }

      await fetchRoster();

      setShowConfirm(false);
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

    const { last_name, first_name, participation_mode, assigned_seat, has_omiyage, omiyage_shop, omiyage_item } = supervisionForm;

    const participantPayload: Record<string, any> = {};
    if (last_name !== undefined) participantPayload.last_name = last_name;
    if (first_name !== undefined) participantPayload.first_name = first_name;

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
    // 受付状態のみ解除する（DELETEはしない）。座席（assigned_seat）や Summer Con の
    // メンバーエリア（member_seat_range）は、事前に取り込んだ座席配置なので保持する。
    // 再度受付する際にこの席が自動で復元される。
    const { error } = await supabase
      .from('attendances')
      .update({ checked_in: false, has_omiyage: false, omiyage_shop: null, omiyage_item: null })
      .eq('meeting_id', activeMeeting.id)
      .eq('participant_id', p.id);
    setLoading(false);
    if (error) { alert(`エラー： ${error.message}`); } else { fetchRoster(); }
  };

  // ---------------- MOTEURS DE GÉNÉRATION D'IMPRESSION ----------------
  const generateObserversHtml = () => {
    if (checkedInMembers.length === 0) return `<p style="text-align:center; color:#64748b; font-style: italic;">Aucun observateur enregistré.</p>`;

    const rows = checkedInMembers.map(p => `
      <tr style="background-color: #c9daf8; font-size: 11px;">
        <td style="border: 1px solid #000; padding: 4px 8px; text-align: center; width: 35%;">${p.loms?.name_kana || ''}</td>
        <td style="border: 1px solid #000; padding: 4px; text-align: center; width: 15%;"></td>
        <td style="border: 1px solid #000; padding: 4px 12px; text-align: left; width: 40%;">${p.last_name_kana} ${p.first_name_kana}</td>
        <td style="border: 1px solid #000; padding: 4px; text-align: center; width: 10%;"></td>
      </tr>
      <tr style="font-size: 15px;">
        <td style="border: 1px solid #000; padding: 8px; text-align: center; font-weight: bold;">${p.loms?.name || '—'} 青年会議所</td>
        <td style="border: 1px solid #000; padding: 8px; text-align: center;">理事長</td>
        <td style="border: 1px solid #000; padding: 8px 12px; text-align: left; font-weight: bold;">${p.last_name} ${p.first_name}</td>
        <td style="border: 1px solid #000; padding: 8px; text-align: center;">君</td>
      </tr>
    `).join('');

    return `
      <h1 style="text-align: center; font-size: 20px; margin-bottom: 20px; font-family: 'Meiryo', 'Yu Gothic', sans-serif;">登録者・オブザーバーリスト</h1>
      <table style="width: 100%; border-collapse: collapse; border: 2px solid #000; font-family: 'Meiryo', 'Yu Gothic', sans-serif; margin-bottom: 32px;">
        <tbody>${rows}</tbody>
      </table>
      <p style="text-align: center; font-size: 15px; font-weight: bold; font-family: 'Meiryo', 'Yu Gothic', sans-serif; letter-spacing: 0.5px; margin-top: 24px;">
        改めましてオブザーブいただきました理事長の皆様に盛大な拍手をお願いいたします。
      </p>
    `;
  };

  const generateOmiyageHtml = () => {
    const omiyages = checkedInMembers.filter(p => p.has_omiyage);
    if (omiyages.length === 0) return `<p style="text-align:center; color:#64748b; font-style: italic; font-size: 18px;">Aucun Omiyage enregistré pour le moment.</p>`;

    const rows = omiyages.map(p => `
      <tr style="background-color: #c9daf8; font-size: 11px;">
        <td style="border: 1px solid #000; padding: 4px 8px; text-align: center; width: 35%;">${p.loms?.name_kana || ''}</td>
        <td style="border: 1px solid #000; padding: 4px; text-align: center; width: 15%;"></td>
        <td style="border: 1px solid #000; padding: 4px 12px; text-align: left; width: 40%;">${p.last_name_kana} ${p.first_name_kana}</td>
        <td style="border: 1px solid #000; padding: 4px; text-align: center; width: 10%;"></td>
      </tr>
      <tr style="font-size: 15px;">
        <td style="border: 1px solid #000; padding: 8px; text-align: center; font-weight: bold;">${p.loms?.name || '—'} 青年会議所</td>
        <td style="border: 1px solid #000; padding: 8px; text-align: center;">理事長</td>
        <td style="border: 1px solid #000; padding: 8px 12px; text-align: left; font-weight: bold;">${p.last_name} ${p.first_name}</td>
        <td style="border: 1px solid #000; padding: 8px; text-align: center;">君</td>
      </tr>
      <tr style="font-size: 16px;">
        <td colspan="4" style="border: 1px solid #000; padding: 12px; text-align: center; line-height: 1.6;">
          より ${p.omiyage_shop || '—'} さんの<br/>
          ${p.omiyage_item || '—'} を頂戴しております。
        </td>
      </tr>
    `).join('');

    return `
      <h1 style="text-align: center; font-size: 20px; color: #0f172a; margin-bottom: 20px; font-family: 'Meiryo', 'Yu Gothic', sans-serif;">🎁 お土産 披露リスト</h1>
      <table style="width: 100%; border-collapse: collapse; border: 2px solid #000; font-family: 'Meiryo', 'Yu Gothic', sans-serif; margin-bottom: 32px;">
        <tbody>${rows}</tbody>
      </table>
      <p style="text-align: center; font-size: 15px; font-weight: bold; font-family: 'Meiryo', 'Yu Gothic', sans-serif; letter-spacing: 0.5px; margin-top: 24px;">
        改めましてオブザーブいただきました理事長の皆様に盛大な拍手をお願いいたします。
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
            <title>${printPreview.title}</title>
            <style>
              body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 40px; color: #0f172a; }
              table, tr, td {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
                border-collapse: collapse !important;
              }
              @media print {
                body { padding: 0; }
                @page { margin: 1.5cm; }
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

  return (
    <div style={{ maxWidth: '1240px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* ---------------- BARRE D'OUTILS ET DE NAVIGATION ---------------- */}
      <div style={{ backgroundColor: '#fff', padding: '16px 24px', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', borderTop: '3px solid #0B1F3A' }}>
        <div style={{ display: 'flex', gap: '8px', backgroundColor: '#f1f5f9', padding: '4px', borderRadius: '10px' }}>
          <button onClick={() => setActiveTab('CHECKIN')} style={{ padding: '8px 24px', borderRadius: '8px', border: 'none', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s', backgroundColor: activeTab === 'CHECKIN' ? '#00A3E0' : 'transparent', color: activeTab === 'CHECKIN' ? '#fff' : '#475569' }}>📡 受付モード</button>
          <button onClick={() => setActiveTab('SUPERVISION')} style={{ padding: '8px 24px', borderRadius: '8px', border: 'none', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s', backgroundColor: activeTab === 'SUPERVISION' ? '#0B1F3A' : 'transparent', color: activeTab === 'SUPERVISION' ? '#F5C842' : '#475569' }}>👁️ 管理（{checkedInMembers.length}）</button>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={() => setPrintPreview({ title: 'プレビュー：オブザーバーリスト', html: generateObserversHtml() })} style={actionBtnStyle('#3b82f6')}><Users size={16}/> オブザーバーリスト</button>
          <button onClick={() => setPrintPreview({ title: 'プレビュー：お土産リスト', html: generateOmiyageHtml() })} style={actionBtnStyle('#8b5cf6')}><FileText size={16}/> お土産リスト</button>
          <button onClick={() => setShowOmiyageModal(true)} style={actionBtnStyle('#ea580c')}><Gift size={16}/> お土産クイック入力</button>
        </div>
      </div>

      {/* ---------------- VUE 1 : MODE ACCUEIL (Radar + Formulaire) ---------------- */}
      {activeTab === 'CHECKIN' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '24px' }}>

          <div style={{ backgroundColor: '#fff', padding: '24px', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', color: '#0B1F3A' }}>🔍 理事長検索</h3>
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

          <div style={{ backgroundColor: '#fff', padding: '32px', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
            {selectedParticipant ? (
              <form onSubmit={e => { e.preventDefault(); setShowConfirm(true); }}>

                <div style={{ display: 'inline-block', padding: '16px 32px', backgroundColor: '#f0f9ff', color: '#00A3E0', borderRadius: '12px', marginBottom: '28px', border: '2px solid #bae6fd', boxShadow: '0 2px 4px rgba(0, 163, 224, 0.1)' }}>
                  {(selectedParticipant.loms?.block || selectedParticipant.loms?.region) && (
                    <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#0284c7', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>
                      {selectedParticipant.loms?.block} {selectedParticipant.loms?.region ? `• ${selectedParticipant.loms?.region}` : ''}
                    </div>
                  )}
                  <div style={{ fontSize: '28px', fontWeight: '900', letterSpacing: '1px', lineHeight: '1.2' }}>{selectedParticipant.loms?.name}</div>
                  <div style={{ fontSize: '14px', fontWeight: 'bold', textAlign: 'center', marginTop: '6px', color: '#0284c7' }}>
                    {editLomKana || selectedParticipant.loms?.name_kana || '—'}
                  </div>
                </div>

                <h2 style={{ margin: '0 0 24px 0', fontSize: '20px', fontWeight: 900, color: '#0B1F3A' }}>受付情報</h2>

                <div style={{ backgroundColor: '#f8fafc', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '24px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div><label style={labelStyle}>姓</label><input type="text" style={inputStyle} value={editLastName} onChange={e => setEditLastName(e.target.value)} /></div>
                    <div><label style={labelStyle}>名</label><input type="text" style={inputStyle} value={editFirstName} onChange={e => setEditFirstName(e.target.value)} /></div>
                    <div><label style={labelStyle}>ふりがな（姓）</label><input type="text" style={inputStyle} value={editLastNameKana} onChange={e => setEditLastNameKana(e.target.value)} /></div>
                    <div><label style={labelStyle}>ふりがな（名）</label><input type="text" style={inputStyle} value={editFirstNameKana} onChange={e => setEditFirstNameKana(e.target.value)} /></div>
                    <div style={{ gridColumn: 'span 2', marginTop: '8px' }}><label style={{...labelStyle, color:'#00A3E0'}}>所属LOM ふりがな</label><input type="text" style={{...inputStyle, borderColor: '#bae6fd', backgroundColor: '#f0f9ff'}} value={editLomKana} onChange={e => setEditLomKana(e.target.value)} /></div>
                  </div>
                </div>

                <div style={{ backgroundColor: '#f8fafc', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '24px' }}>
                  {isSeatedMeeting ? (
                    <div>
                      <label style={{ ...labelStyle, color: '#0ea5e9' }}>📍 指定座席（固定制）</label>
                      <input type="text" placeholder="座席を指定（空欄で自動）" style={inputStyle} value={specificSeatInput} onChange={(e) => { setSpecificSeatInput(e.target.value); setMode('現地'); }} />
                      <p style={{ fontSize: '12px', margin: '8px 0 0 0', color: '#64748b' }}>次の空席：<strong>{nextAutomaticSeat}</strong></p>
                    </div>
                  ) : (
                    <div>
                      <label style={labelStyle}>参加形式</label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button type="button" onClick={() => setMode('現地')} style={{ flex: 1, padding: '10px', borderRadius: '8px', border: mode === '現地' ? '2px solid #10b981' : '1px solid #cbd5e1', fontWeight: 'bold', backgroundColor: mode === '現地' ? '#f0fdf4' : '#fff', color: mode === '現地' ? '#16a34a' : '#475569' }}>🏢 現地</button>
                        <button type="button" onClick={() => setMode('ZOOM')} style={{ flex: 1, padding: '10px', borderRadius: '8px', border: mode === 'ZOOM' ? '2px solid #00A3E0' : '1px solid #cbd5e1', fontWeight: 'bold', backgroundColor: mode === 'ZOOM' ? '#f0f9ff' : '#fff', color: mode === 'ZOOM' ? '#00A3E0' : '#475569' }}>💻 Zoom</button>
                      </div>
                    </div>
                  )}
                  {activeMeeting.seating_strategy === 'SUMMER_CON' && (
                    <div style={{ marginTop: '16px' }}>
                      <label style={labelStyle}>LOM同伴メンバー数</label>
                      <input type="number" style={inputStyle} value={lomMembersCount} onChange={e => setLomMembersCount(parseInt(e.target.value)||0)} />
                      {selectedParticipant.member_seat_range && (
                        <p style={{ fontSize: '12px', margin: '8px 0 0 0', color: '#64748b' }}>
                          メンバーエリア（予約枠）：<strong>{selectedParticipant.member_seat_range}</strong>
                          {lomMembersCount > 0 && (
                            <> ／ 実際の使用範囲：<strong style={{ color: '#0ea5e9' }}>{computeMemberRangeDisplay(selectedParticipant.member_seat_range, lomMembersCount)}</strong>（{lomMembersCount}名）</>
                          )}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div style={{ padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', backgroundColor: hasOmiyage ? '#fffbeb' : '#fff' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', fontWeight: 'bold', color: '#d97706' }}>
                    <input type="checkbox" checked={hasOmiyage} onChange={(e) => setHasOmiyage(e.target.checked)} style={{ width: '18px', height: '18px' }} />
                    🎁 お土産の申告（詳細は後で入力可）
                  </label>
                </div>

                <button type="submit" style={{ width: '100%', padding: '16px', borderRadius: '10px', border: 'none', backgroundColor: '#00A3E0', color: '#fff', fontWeight: '900', fontSize: '16px', cursor: 'pointer', marginTop: '24px' }}>受付を確定</button>
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
          <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', color: '#0B1F3A' }}>👁️ 座席・情報の管理</h3>
          <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '16px' }}>座席の割り当てや氏名の表記をこの画面から直接修正できます。表示順は席次に従います。</p>

          <input
            type="text"
            placeholder="🔍 氏名、LOM名、認証番号で絞り込み..."
            value={supervisionSearch}
            onChange={(e) => setSupervisionSearch(e.target.value)}
            style={{ ...inputStyle, marginBottom: '16px', maxWidth: '360px' }}
          />

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569' }}>
                  <th style={{ padding: '12px' }}>LOM</th>
                  <th style={{ padding: '12px' }}>氏名（漢字）</th>
                  <th style={{ padding: '12px' }}>参加形式</th>
                  <th style={{ padding: '12px' }}>📍 座席</th>
                  <th style={{ padding: '12px', textAlign: 'center' }}>🎁 お土産</th>
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
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <input style={{...inputStyle, padding: '4px'}} value={supervisionForm.last_name||''} onChange={e=>setSupervisionForm({...supervisionForm, last_name: e.target.value})} />
                            <input style={{...inputStyle, padding: '4px'}} value={supervisionForm.first_name||''} onChange={e=>setSupervisionForm({...supervisionForm, first_name: e.target.value})} />
                          </div>
                        ) : (
                          `${p.last_name} ${p.first_name}`
                        )}
                      </td>
                      <td style={{ padding: '12px' }}>
                        {isEditing ? (
                          <select style={{...inputStyle, padding: '4px'}} value={supervisionForm.participation_mode} onChange={e=>setSupervisionForm({...supervisionForm, participation_mode: e.target.value as any})}>
                            <option value="現地">🏢 現地</option>
                            <option value="ZOOM">💻 Zoom</option>
                          </select>
                        ) : (p.participation_mode === 'ZOOM' ? '💻 Zoom' : '🏢 現地')}
                      </td>
                      <td style={{ padding: '12px' }}>
                        {isEditing ? (
                          <input style={{...inputStyle, padding: '4px', borderColor: '#38bdf8'}} value={supervisionForm.assigned_seat||''} onChange={e=>setSupervisionForm({...supervisionForm, assigned_seat: e.target.value})} />
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <span style={{ backgroundColor: '#dcfce7', color: '#16a34a', padding: '4px 8px', borderRadius: '4px', fontWeight: 'bold', width: 'fit-content' }}>{p.assigned_seat}</span>
                            {activeMeeting.seating_strategy === 'SUMMER_CON' && p.member_seat_range && p.lom_members_count > 0 && (
                              <span style={{ fontSize: '11px', color: '#0ea5e9', fontWeight: 'bold' }}>
                                🧑‍🤝‍🧑 {computeMemberRangeDisplay(p.member_seat_range, p.lom_members_count)}（{p.lom_members_count}名）
                              </span>
                            )}
                          </div>
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
              🎁 登録
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

      {/* POPUP DE CONFIRMATION (Émargement principal) */}
      {showConfirm && selectedParticipant && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(11, 31, 58, 0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: '#fff', borderRadius: '16px', padding: '32px', width: '400px' }}>
            <h3 style={{ margin: '0 0 24px 0', textAlign: 'center', fontSize: '20px' }}>座席の確定</h3>
            <p style={{ textAlign: 'center', fontSize: '16px', fontWeight: 'bold', color: '#16a34a', backgroundColor: '#dcfce7', padding: '12px', borderRadius: '8px' }}>
              座席：{mode === 'ZOOM' ? 'Distanciel' : (isSeatedMeeting && specificSeatInput.trim() ? specificSeatInput.trim().toUpperCase() : nextAutomaticSeat)}
            </p>
            {activeMeeting.seating_strategy === 'SUMMER_CON' && selectedParticipant.member_seat_range && lomMembersCount > 0 && (
              <p style={{ textAlign: 'center', fontSize: '13px', fontWeight: 'bold', color: '#0ea5e9', backgroundColor: '#f0f9ff', padding: '10px', borderRadius: '8px', marginTop: '8px' }}>
                🧑‍🤝‍🧑 メンバー席：{computeMemberRangeDisplay(selectedParticipant.member_seat_range, lomMembersCount)}（{lomMembersCount}名）
              </p>
            )}
            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              <button onClick={() => setShowConfirm(false)} style={{ flex: 1, padding: '12px', backgroundColor: '#f1f5f9', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>キャンセル</button>
              <button onClick={executeCheckIn} style={{ flex: 1, padding: '12px', backgroundColor: '#00A3E0', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>確定</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

const actionBtnStyle = (color: string) => ({ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', backgroundColor: color, color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold' as const, fontSize: '13px', cursor: 'pointer', transition: 'opacity 0.2s' });
const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', color: '#334155', fontSize: '13px', boxSizing: 'border-box' as const, outline: 'none' };
const labelStyle = { display: 'block', fontSize: '11px', color: '#64748b', marginBottom: '4px', fontWeight: 'bold' as const };
