import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { Search, RotateCcw, Save, Shield, X, Map as MapIcon } from 'lucide-react';

interface Props {
  activeYear: number;
}

export const SystemSettings: React.FC<Props> = ({ activeYear }) => {
  // --- ÉTATS IMPORTATION CSV (MEIBO) ---
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- ÉTATS IMPORTATION TOPOGRAPHIE (SUMMER CON) ---
  const [summerLoading, setSummerLoading] = useState(false);
  const summerFileInputRef = useRef<HTMLInputElement>(null);

  const [summerMeetings, setSummerMeetings] = useState<any[]>([]);
  const [targetMeetingId, setTargetMeetingId] = useState<string>('');

  // --- ÉTATS GESTIONNAIRE DE PRÉSÉANCE ---
  const [loms, setLoms] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLom, setSelectedLom] = useState<any | null>(null);
  const [priorityValue, setPriorityValue] = useState<number>(1);
  const [priorityLoading, setPriorityLoading] = useState(false);

  const addLog = (msg: string) => setLogs(prev => [...prev, msg]);

  // Détecte automatiquement le séparateur CSV (Excel japonais exporte souvent en ';', pas en ',').
  const detectDelimiter = (headerLine: string): string => {
    const semicolons = (headerLine.match(/;/g) || []).length;
    const commas = (headerLine.match(/,/g) || []).length;
    return semicolons > commas ? ';' : ',';
  };

  // Analyseur CSV robuste (façon RFC4180) : contrairement à un simple split(),
  // il gère correctement les champs entre guillemets pouvant contenir le séparateur
  // lui-même, un retour à la ligne, ou des guillemets échappés ("" → ").
  // Sans ça, un nom de LOM ou un nom de personne contenant accidentellement le
  // séparateur (ex: une virgule dans un champ non prévu par Excel) décale toutes
  // les colonnes suivantes silencieusement.
  const parseCSV = (text: string, delimiter: string): string[][] => {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    let i = 0;

    while (i < text.length) {
      const char = text[i];

      if (inQuotes) {
        if (char === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        field += char;
        i++;
        continue;
      }

      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (char === delimiter) {
        row.push(field);
        field = '';
        i++;
        continue;
      }
      if (char === '\r') {
        i++;
        continue; // la fin de ligne est gérée sur \n uniquement
      }
      if (char === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        i++;
        continue;
      }
      field += char;
      i++;
    }

    // dernière ligne si le fichier ne se termine pas par un saut de ligne
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }

    // retire les lignes entièrement vides
    return rows.filter(r => r.some(f => f.trim() !== ''));
  };

  const fetchLoms = async () => {
    const { data, error } = await supabase.from('loms').select('*').order('sort_priority', { ascending: true });
    if (data && !error) setLoms(data);
  };

  const fetchSummerMeetings = async () => {
    const { data, error } = await supabase
      .from('meetings')
      .select('id, type, location_name, meeting_date, seating_strategy, meeting_cycles!inner(year, title)')
      .eq('seating_strategy', 'SUMMER_CON')
      .eq('meeting_cycles.year', activeYear);

    if (error) {
      console.error(error);
      setSummerMeetings([]);
      return;
    }
    setSummerMeetings(data || []);
    setTargetMeetingId(data && data.length === 1 ? data[0].id : '');
  };

  useEffect(() => {
    fetchLoms();
  }, []);

  useEffect(() => {
    fetchSummerMeetings();
  }, [activeYear]);

  // --- MOTEUR 1 : IMPORTATION DU MEIBO ---
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setLogs([]);
    addLog(`${activeYear}年度の名簿を読み込んでいます... ファイル：${file.name}`);

    try {
      const rawText = await file.text();
      const text = rawText.replace(/^\uFEFF/, ''); // 先頭のBOMを除去（日本語Excel対策）
      const firstLine = text.split('\n')[0] || '';
      const delimiter = detectDelimiter(firstLine);
      const csvRows = parseCSV(text, delimiter);

      addLog(`${csvRows.length - 1} 件のプロフィールを検出。LOMデータを整理しています...`);

      const lomsMap = new Map<string, { kana: string, block: string, region: string }>();
      const rawParticipants = [];

      for (let i = 1; i < csvRows.length; i++) {
        const cols = csvRows[i].map(c => c.trim());
        if (cols.length < 7) continue;

        const auth_id = cols[0];
        let lom_name = cols[1];
        const lom_kana = cols[2];
        const last_name = cols[3];
        const first_name = cols[4];
        const last_name_kana = cols[5];
        const first_name_kana = cols[6];

        const block = cols[7] || '';
        const region = cols[8] || '';

        lom_name = lom_name.replace(/公益社団法人|一般社団法人/g, '').trim();

        if (lom_name) lomsMap.set(lom_name, { kana: lom_kana, block, region });

        rawParticipants.push({
          auth_id,
          lom_name,
          last_name,
          first_name,
          last_name_kana,
          first_name_kana
        });
      }

      addLog(`${lomsMap.size} 件のLOMを登録しています...`);
      const lomsToInsert = Array.from(lomsMap.entries()).map(([name, data]) => ({
        name,
        name_kana: data.kana,
        block: data.block,
        region: data.region,
        sort_priority: 50
      }));

      const { error: lomError } = await supabase.from('loms').upsert(lomsToInsert, { onConflict: 'name' });
      if (lomError) throw lomError;

      const { data: dbLoms, error: fetchError } = await supabase.from('loms').select('id, name');
      if (fetchError || !dbLoms) throw fetchError;
      const lomIdMap = new Map(dbLoms.map(l => [l.name, l.id]));

      addLog(`${activeYear}年度のメンバー ${rawParticipants.length} 件を登録しています...`);
      const participantsToInsert = rawParticipants.map(p => ({
        auth_id: p.auth_id,
        mandate_year: activeYear,
        lom_id: lomIdMap.get(p.lom_name),
        last_name: p.last_name,
        first_name: p.first_name,
        last_name_kana: p.last_name_kana,
        first_name_kana: p.first_name_kana
      }));

      const { error: pError } = await supabase.from('participants').upsert(participantsToInsert, { onConflict: 'auth_id, mandate_year' });
      if (pError) throw pError;

      addLog(`✅ 完了。${activeYear}年度の全国名簿が有効になりました。`);
      fetchLoms();

    } catch (err: any) {
      addLog(`❌ 重大なエラー： ${err.message}`);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // --- MOTEUR 2 : MOTEUR DE CIBLAGE TOPOGRAPHIQUE (SUMMER CON) ---
  const handleSummerConUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!targetMeetingId) {
      alert('先にサマーカンファレンスの対象会議を選択してください。');
      if (summerFileInputRef.current) summerFileInputRef.current.value = '';
      return;
    }

    setSummerLoading(true);
    setLogs([]);
    addLog(`${activeYear}年度の座席配置エンジンを起動しています...`);

    try {
      const rawText = await file.text();
      const text = rawText.replace(/^\uFEFF/, ''); // 先頭のBOMを除去（日本語Excel対策）
      const firstLine = text.split('\n')[0] || '';
      const delimiter = detectDelimiter(firstLine);
      const csvRows = parseCSV(text, delimiter);
      addLog(`区切り文字を検出： "${delimiter}"`);

      // 1. 対象年度の参加者を取得（氏名・LOM情報のみ。座席は attendances 側で管理）
      const { data: dbParts, error: dbError } = await supabase
        .from('participants')
        .select(`id, lom_id, loms ( name, block, region, sort_priority )`)
        .eq('mandate_year', activeYear);

      if (dbError) throw dbError;

      if (!dbParts || dbParts.length === 0) {
        throw new Error(`${activeYear}年度の参加者が見つかりません。先に名簿をアップロードしてください。`);
      }

      // 既にこの会議で受付済み（checked_in = true）の参加者は、再アップロードで
      // 座席を変更・上書きしない（すでに着席している人の席を勝手に動かさないため）。
      const { data: existingAtt, error: existingAttError } = await supabase
        .from('attendances')
        .select('participant_id, checked_in, assigned_seat')
        .eq('meeting_id', targetMeetingId);

      if (existingAttError) throw existingAttError;

      const alreadyCheckedIn = new Set(
        (existingAtt || []).filter(a => a.checked_in).map(a => a.participant_id)
      );

      const assignableParts = (dbParts as any[]).filter(p => !alreadyCheckedIn.has(p.id));

      if (alreadyCheckedIn.size > 0) {
        addLog(`ℹ️ 既に受付済みの ${alreadyCheckedIn.size} 名は対象から除外し、座席をそのまま維持します。`);
      }

      const updatesMap = new Map<string, { assigned_seat?: string, member_seat_range?: string }>();
      const usedSeats = new Set<string>();
      (existingAtt || []).forEach(a => {
        if (a.checked_in && a.assigned_seat) usedSeats.add(a.assigned_seat);
      });
      const assignedPresidents = new Set<string>();

      // 連続座席の生成（例：1〜17 → [1, 2, ..., 17]、接頭辞ありも可）
      const generateSeatRange = (start: string, end: string): string[] => {
        if (!end || start === end) return [start];
        const regex = /^([a-zA-Z\s_-]*)(\d+)$/;
        const matchStart = start.match(regex);
        const matchEnd = end.match(regex);

        if (matchStart && matchEnd && matchStart[1] === matchEnd[1]) {
          const prefix = matchStart[1];
          const numStart = parseInt(matchStart[2], 10);
          const numEnd = parseInt(matchEnd[2], 10);
          const padLen = matchStart[2].length;
          const range = [];
          for (let i = numStart; i <= numEnd; i++) {
            range.push(`${prefix}${String(i).padStart(padLen, '0')}`);
          }
          return range;
        }
        return [];
      };

      // 2. ルールの分類：明示的なターゲット（LOM／ブロック／地区）と一般ルール
      //    （A列が空 = 「他のどのルールにも該当しない理事長・メンバー全員」）
      type Rule = { targetName: string; role: string; startSeat: string; endSeat: string; lineNum: number };
      const specificRules: Rule[] = [];
      const catchAllRules: Rule[] = [];

      for (let i = 1; i < csvRows.length; i++) { // 1行目はヘッダーなので無視
        const cols = csvRows[i].map(c => c.trim());
        if (cols.length < 3) continue;

        const rule: Rule = {
          targetName: cols[0],
          role: cols[1], // "理事長" または "メンバー"（英仏語のレガシー表記にも対応）
          startSeat: cols[2],
          endSeat: cols[3] || '',
          lineNum: i + 1,
        };

        if (rule.targetName) specificRules.push(rule);
        else catchAllRules.push(rule);
      }

      const isPresidentRole = (role: string) => role.includes('理事長') || role.toLowerCase().includes('president') || role.toLowerCase().includes('président');
      const isMemberRole = (role: string) => role.includes('メンバー') || role.toLowerCase().includes('member') || role.toLowerCase().includes('membre');

      // 都市名のみの指定（例：「京都」）は「京都青年会議所」に自動マッチする。
      const LOM_SUFFIX = '青年会議所';
      const stripLomSuffix = (name: string) => name.endsWith(LOM_SUFFIX) ? name.slice(0, -LOM_SUFFIX.length) : name;

      let matchedRows = 0;

      // --- パス1：明示的なルール（LOM／ブロック／地区が指定されている行） ---
      for (const rule of specificRules) {
        const { targetName, role, startSeat, endSeat, lineNum } = rule;

        const targets = (assignableParts as any[]).filter(p => {
          const lom = Array.isArray(p.loms) ? p.loms[0] : p.loms;
          if (!lom) return false;
          return lom.name === targetName ||
                 stripLomSuffix(lom.name) === targetName ||
                 lom.block === targetName ||
                 lom.region === targetName;
        });

        if (targets.length === 0) {
          addLog(`⚠️ ${lineNum}行目：「${targetName}」に一致するLOM／ブロック／地区が見つかりません（表記を確認してください）。`);
          continue;
        }
        matchedRows++;

        // 席次に基づく決定論的な並び替え
        targets.sort((a, b) => {
          const lomA = Array.isArray(a.loms) ? a.loms[0] : a.loms;
          const lomB = Array.isArray(b.loms) ? b.loms[0] : b.loms;
          return (lomA?.sort_priority || 50) - (lomB?.sort_priority || 50);
        });

        if (isPresidentRole(role)) {
          // 個別の椅子を割り当て
          const availableSeats = generateSeatRange(startSeat, endSeat).filter(s => !usedSeats.has(s));
          let seatIndex = 0;

          for (const p of targets) {
            if (!assignedPresidents.has(p.id) && seatIndex < availableSeats.length) {
              const assigned = availableSeats[seatIndex];
              if (!updatesMap.has(p.id)) updatesMap.set(p.id, {});
              updatesMap.get(p.id)!.assigned_seat = assigned;

              usedSeats.add(assigned);
              assignedPresidents.add(p.id);
              seatIndex++;
            }
          }
        } else if (isMemberRole(role)) {
          // グループ用のエリアを割り当て
          const rangeStr = endSeat ? `${startSeat} ~ ${endSeat}` : startSeat;
          for (const p of targets) {
            if (!updatesMap.has(p.id)) updatesMap.set(p.id, {});
            // 最初に一致したルール（上にあるほど優先）がエリアを確定する
            if (!updatesMap.get(p.id)!.member_seat_range) {
              updatesMap.get(p.id)!.member_seat_range = rangeStr;
            }
          }
        } else {
          addLog(`⚠️ ${lineNum}行目：役割「${role}」を認識できません（想定：理事長／メンバー）。`);
        }
      }

      // --- パス2：一般ルール（A列が空）＝ パス1で未割当のまま残っている全員が対象。
      //     ファイル内の記載順で処理し、同じ「残り」プールを続けて消費する
      //     （連続する2行の一般ルールは、続けて同じ残りの人たちを配置する）。
      const remainingPresidents = (assignableParts as any[])
        .filter(p => !assignedPresidents.has(p.id))
        .sort((a, b) => {
          const lomA = Array.isArray(a.loms) ? a.loms[0] : a.loms;
          const lomB = Array.isArray(b.loms) ? b.loms[0] : b.loms;
          return (lomA?.sort_priority || 50) - (lomB?.sort_priority || 50);
        });

      const remainingMembers = (assignableParts as any[])
        .filter(p => !updatesMap.get(p.id)?.member_seat_range)
        .sort((a, b) => {
          const lomA = Array.isArray(a.loms) ? a.loms[0] : a.loms;
          const lomB = Array.isArray(b.loms) ? b.loms[0] : b.loms;
          return (lomA?.sort_priority || 50) - (lomB?.sort_priority || 50);
        });

      for (const rule of catchAllRules) {
        const { role, startSeat, endSeat, lineNum } = rule;

        if (isPresidentRole(role)) {
          const availableSeats = generateSeatRange(startSeat, endSeat).filter(s => !usedSeats.has(s));
          let seatIndex = 0;
          let placed = 0;

          while (seatIndex < availableSeats.length && remainingPresidents.length > 0) {
            const p = remainingPresidents.shift()!;
            const assigned = availableSeats[seatIndex];
            if (!updatesMap.has(p.id)) updatesMap.set(p.id, {});
            updatesMap.get(p.id)!.assigned_seat = assigned;

            usedSeats.add(assigned);
            assignedPresidents.add(p.id);
            seatIndex++;
            placed++;
          }
          addLog(`🌐 ${lineNum}行目（一般ルール、${startSeat}${endSeat ? ' ~ ' + endSeat : ''}）：残りの理事長 ${placed} 名を配置しました。`);
          matchedRows++;
        } else if (isMemberRole(role)) {
          const rangeStr = endSeat ? `${startSeat} ~ ${endSeat}` : startSeat;
          let placed = 0;
          while (remainingMembers.length > 0) {
            const p = remainingMembers.shift()!;
            if (!updatesMap.has(p.id)) updatesMap.set(p.id, {});
            updatesMap.get(p.id)!.member_seat_range = rangeStr;
            placed++;
          }
          addLog(`🌐 ${lineNum}行目（一般ルール、${rangeStr}）：残りのメンバー ${placed} 名をエリアに割り当てました。`);
          matchedRows++;
        } else {
          addLog(`⚠️ ${lineNum}行目：役割「${role}」を認識できません（想定：理事長／メンバー）。`);
        }
      }

      if (remainingPresidents.length > 0) {
        addLog(`⚠️ ${remainingPresidents.length} 名の理事長が未配置です（座席範囲が不足しているか、ファイルに記載がありません）。`);
      }

      // 3. attendances へ upsert（対象会議に限定）。assigned_seat / member_seat_range
      //    のみを送信し、checked_in や has_omiyage など他の項目は変更しない。
      if (updatesMap.size > 0) {
        addLog(`集計完了。${updatesMap.size} 件の配置情報をサーバーへ送信しています...`);

        const rows = Array.from(updatesMap.entries()).map(([participant_id, payload]) => ({
          meeting_id: targetMeetingId,
          participant_id,
          ...payload,
        }));

        const { error: upsertError } = await supabase
          .from('attendances')
          .upsert(rows, { onConflict: 'meeting_id, participant_id' });

        if (upsertError) {
          if (upsertError.code === '23505') {
            throw new Error('座席の重複が検出されました（同じ席番号が複数回使われています）。CSVファイルの席番号の範囲が重なっていないか確認してください。');
          }
          throw upsertError;
        }

        addLog(`✅ ${activeYear}年度の座席配置が確定しました！（${matchedRows}/${csvRows.length - 1} 行を反映）`);
      } else {
        addLog(`⚠️ ファイル内のルールに一致する参加者がいませんでした（0/${csvRows.length - 1} 行）。上記のログで詳細をご確認ください。`);
      }

    } catch (err: any) {
      addLog(`❌ 座席配置エラー： ${err.message}`);
    } finally {
      setSummerLoading(false);
      if (summerFileInputRef.current) summerFileInputRef.current.value = '';
    }
  };

  // --- MOTEUR 3 : PRÉSÉANCE ---
  const handleUpdatePriority = async () => {
    if (!selectedLom) return;
    setPriorityLoading(true);
    const { error } = await supabase.from('loms').update({ sort_priority: priorityValue }).eq('id', selectedLom.id);

    if (error) alert(`エラー： ${error.message}`);
    else { await fetchLoms(); setSelectedLom(null); setSearchTerm(''); }
    setPriorityLoading(false);
  };

  const handleResetPriorities = async () => {
    const confirm = window.confirm('⚠️ すべての席次設定をリセットしますか？');
    if (!confirm) return;
    setPriorityLoading(true);
    const { error } = await supabase.from('loms').update({ sort_priority: 50 }).neq('sort_priority', 50);
    if (error) alert(`エラー： ${error.message}`);
    else { await fetchLoms(); alert('席次設定をリセットしました。'); }
    setPriorityLoading(false);
  };

  const searchResults = searchTerm.trim() === '' ? [] : loms.filter(l => l.name.includes(searchTerm) || l.name_kana?.includes(searchTerm)).slice(0, 5);
  const priorityLoms = loms.filter(l => l.sort_priority !== 50).sort((a, b) => a.sort_priority - b.sort_priority);

  return (
    <div style={{ backgroundColor: '#fff', padding: '32px', borderRadius: '16px', border: '1px solid #e2e8f0', maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', borderTop: '3px solid #0B1F3A' }}>
      <h2 style={{ margin: 0, color: '#0B1F3A', borderBottom: '1px solid #f1f5f9', paddingBottom: '16px', fontSize: '24px', fontWeight: '900' }}>
        ⚙️ システム設定
      </h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>

        {/* BLOC 1 : IMPORTATION DU MEIBO */}
        <div style={{ backgroundColor: '#f8fafc', padding: '24px', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', color: '#334155', fontWeight: '900' }}>📥 年度別名簿の取り込み</h3>

          <p style={{ fontSize: '13px', color: '#475569', marginBottom: '20px', lineHeight: 1.5 }}>
            選択した年度のCSV名簿（Meibo）を取り込みます。すべてのLOMと理事長がここに登録されます。
          </p>

          <input type="file" accept=".csv" ref={fileInputRef} onChange={handleFileUpload} disabled={loading || summerLoading} style={{ display: 'none' }} id="meibo-upload" />
          <label htmlFor="meibo-upload" style={{ display: 'block', textAlign: 'center', padding: '14px 24px', backgroundColor: loading ? '#94a3b8' : '#00A3E0', color: '#fff', borderRadius: '8px', fontWeight: 'bold', cursor: loading ? 'not-allowed' : 'pointer', transition: 'background-color 0.2s', marginTop: 'auto' }}>
            {loading ? '取り込み中...' : '📁 名簿をアップロード（CSV）'}
          </label>
        </div>

        {/* BLOC 2 : TOPOGRAPHIE SUMMER CON */}
        <div style={{ backgroundColor: '#f0f9ff', padding: '24px', borderRadius: '12px', border: '1px solid #bae6fd', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', color: '#0369a1', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '900' }}>
            <MapIcon size={18} color="#0284c7" /> 座席配置エンジン（サマーカンファレンス）
          </h3>

          <p style={{ fontSize: '13px', color: '#475569', marginBottom: '16px', lineHeight: 1.5 }}>
            座席配置のルール（CSV）を取り込みます。LOMを指定した詳細ルールはファイルの上部に、ブロック／地区／欄が空の一般ルールは下部に配置してください。
          </p>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: '#0369a1', marginBottom: '4px', fontWeight: 'bold' }}>対象の会議</label>
            <select
              value={targetMeetingId}
              onChange={(e) => setTargetMeetingId(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #7dd3fc', color: '#0369a1', fontSize: '13px', fontWeight: 'bold', backgroundColor: '#fff', outline: 'none' }}
            >
              <option value="">— 会議を選択 —</option>
              {summerMeetings.map(m => (
                <option key={m.id} value={m.id}>
                  {m.meeting_cycles?.title || ''} — {m.location_name}（{m.meeting_date}）
                </option>
              ))}
            </select>
            {summerMeetings.length === 0 && (
              <p style={{ fontSize: '11px', color: '#dc2626', marginTop: '6px' }}>
                {activeYear}年度に「サマーカンファレンス」プロトコルの会議が存在しません。サイクル詳細画面から作成・設定してください。
              </p>
            )}
          </div>

          <input type="file" accept=".csv" ref={summerFileInputRef} onChange={handleSummerConUpload} disabled={loading || summerLoading || !targetMeetingId} style={{ display: 'none' }} id="summer-upload" />
          <label htmlFor="summer-upload" style={{ display: 'block', textAlign: 'center', padding: '14px 24px', backgroundColor: (summerLoading || !targetMeetingId) ? '#94a3b8' : '#0284c7', color: '#fff', borderRadius: '8px', fontWeight: 'bold', cursor: (summerLoading || !targetMeetingId) ? 'not-allowed' : 'pointer', transition: 'background-color 0.2s', marginTop: 'auto' }}>
            {summerLoading ? '座席を計算中...' : '📍 座席ルールをアップロード'}
          </label>
        </div>

        {/* BLOC 3 : GESTIONNAIRE DE PRÉSÉANCE */}
        <div style={{ backgroundColor: '#f8fafc', padding: '24px', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gridRow: 'span 2' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '16px', color: '#334155', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '900' }}><Shield size={18} color="#d97706" /> 席次（優先順位）設定</h3>
            <button onClick={handleResetPriorities} disabled={priorityLoading} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 'bold' }} title="年度更新時のリセット用"><RotateCcw size={14}/> リセット</button>
          </div>

          <p style={{ fontSize: '12px', color: '#64748b', marginBottom: '20px', lineHeight: 1.5 }}>標準順位は<strong>50</strong>です。数字が小さいほど先に表示されます（例：1を設定すると最優先）。</p>

          <div style={{ position: 'relative', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', backgroundColor: '#fff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0 12px' }}>
              <Search size={16} color="#94a3b8" />
              <input type="text" placeholder="LOMを検索..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ padding: '12px 8px', backgroundColor: 'transparent', border: 'none', color: '#0f172a', width: '100%', outline: 'none', fontSize: '13px' }} />
            </div>

            {searchResults.length > 0 && !selectedLom && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#fff', border: '1px solid #cbd5e1', borderRadius: '8px', marginTop: '4px', zIndex: 10, boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}>
                {searchResults.map(l => (
                  <div key={l.id} onClick={() => { setSelectedLom(l); setSearchTerm(''); setPriorityValue(l.sort_priority); }} style={{ padding: '12px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', fontSize: '13px', color: '#334155' }}>
                    <strong>{l.name}</strong> <span style={{ color: '#94a3b8', fontSize: '11px', float: 'right' }}>（現在：{l.sort_priority}）</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {selectedLom && (
            <div style={{ backgroundColor: '#fff', padding: '16px', borderRadius: '8px', border: '2px solid #f59e0b', marginBottom: '20px' }}>
              <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#d97706', marginBottom: '12px' }}>対象LOM：{selectedLom.name}</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input type="number" min="1" max="99" value={priorityValue} onChange={(e) => setPriorityValue(parseInt(e.target.value) || 50)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#fff', color: '#0f172a', width: '80px', textAlign: 'center', outline: 'none' }} title="1 = 最優先、99 = 最後" />
                <button onClick={handleUpdatePriority} disabled={priorityLoading} style={{ flex: 1, padding: '10px', backgroundColor: '#f59e0b', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}><Save size={16}/> 保存</button>
                <button onClick={() => setSelectedLom(null)} style={{ padding: '10px', backgroundColor: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '6px', cursor: 'pointer' }}><X size={16}/></button>
              </div>
            </div>
          )}

          <div style={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', backgroundColor: '#f1f5f9', fontSize: '11px', fontWeight: '900', color: '#475569', letterSpacing: '0.5px' }}>優先設定のあるLOM（{priorityLoms.length}）</div>
            <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
              {priorityLoms.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>優先設定されたLOMはありません。</div>
              ) : (
                priorityLoms.map(l => (
                  <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #f8fafc', fontSize: '13px', color: '#334155' }}>
                    <span style={{ fontWeight: 'bold' }}>{l.name}</span>
                    <span style={{ fontWeight: '900', color: l.sort_priority < 50 ? '#059669' : '#dc2626', backgroundColor: l.sort_priority < 50 ? '#d1fae5' : '#fee2e2', padding: '2px 8px', borderRadius: '4px' }}>順位 {l.sort_priority}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* TERMINAL DE LOGS COMMUN */}
      {logs.length > 0 && (
        <div style={{ backgroundColor: '#0B1F3A', padding: '16px', borderRadius: '8px', fontFamily: 'monospace', fontSize: '12px', color: '#4ade80', maxHeight: '200px', overflowY: 'auto', border: '1px solid #1e3a5f' }}>
          {logs.map((log, i) => <div key={i} style={{ marginBottom: '6px' }}>{`> ${log}`}</div>)}
        </div>
      )}

    </div>
  );
};
