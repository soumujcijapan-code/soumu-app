import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import type { Equipment, EquipmentCategory, EquipmentLocation } from '../types';
import { Plus, Trash2, Edit2, Check, X, Download } from 'lucide-react';

const CATEGORY_LABELS: Record<EquipmentCategory, string> = {
  SEIFUKU: '正副',
  JOUNIN: '常任',
  RIJIKAI: '理事会',
  SOUKAI: '総会',
  KYOTO_KAIGI: '京都会議',
  SUMMER_CON: 'サマコン',
};

const CATEGORY_ORDER: EquipmentCategory[] = ['SEIFUKU', 'JOUNIN', 'RIJIKAI', 'SOUKAI', 'KYOTO_KAIGI', 'SUMMER_CON'];

const LOCATION_LABELS: Record<EquipmentLocation, string> = {
  OFFICE: '事務局',
  VENUE: '現場',
  SAITAMA_WAREHOUSE: '埼玉倉庫',
  MEMBER: 'メンバー',
  UNKNOWN: '不明',
};

const LOCATION_ORDER: EquipmentLocation[] = ['OFFICE', 'VENUE', 'SAITAMA_WAREHOUSE', 'MEMBER', 'UNKNOWN'];

const LOCATION_COLORS: Record<EquipmentLocation, { bg: string; text: string }> = {
  OFFICE: { bg: '#e0f2fe', text: '#0369a1' },
  VENUE: { bg: '#dcfce7', text: '#16a34a' },
  SAITAMA_WAREHOUSE: { bg: '#fef3c7', text: '#b45309' },
  MEMBER: { bg: '#ede9fe', text: '#7c3aed' },
  UNKNOWN: { bg: '#f1f5f9', text: '#64748b' },
};

export const EquipmentManager: React.FC = () => {
  const [activeCategory, setActiveCategory] = useState<EquipmentCategory>('SEIFUKU');
  const [items, setItems] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(false);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newQuantity, setNewQuantity] = useState(1);
  const [newLocation, setNewLocation] = useState<EquipmentLocation>('UNKNOWN');
  const [newNotes, setNewNotes] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Equipment>>({});

  const [search, setSearch] = useState('');

  const fetchItems = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('equipment')
      .select('*')
      .eq('category', activeCategory)
      .order('name', { ascending: true });
    setLoading(false);
    if (error) {
      console.error(error);
      setItems([]);
      return;
    }
    setItems((data || []) as Equipment[]);
  };

  useEffect(() => {
    fetchItems();
    setShowAddForm(false);
    setEditingId(null);
    setSearch('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory]);

  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const term = search.toLowerCase();
    return items.filter(i =>
      i.name.toLowerCase().includes(term) || (i.notes || '').toLowerCase().includes(term)
    );
  }, [items, search]);

  // ---------------- ACTIONS ----------------
  const handleAdd = async () => {
    if (!newName.trim()) return;
    const { error } = await supabase.from('equipment').insert([{
      category: activeCategory,
      name: newName.trim(),
      quantity: newQuantity || 1,
      location: newLocation,
      notes: newNotes.trim() || null,
    }]);
    if (error) {
      alert(`追加に失敗しました： ${error.message}`);
      return;
    }
    setNewName('');
    setNewQuantity(1);
    setNewLocation('UNKNOWN');
    setNewNotes('');
    setShowAddForm(false);
    fetchItems();
  };

  // 現在地はドロップダウンを変えた瞬間に即保存（編集モードを介さない）
  const handleLocationChange = async (item: Equipment, location: EquipmentLocation) => {
    setItems(prev => prev.map(i => (i.id === item.id ? { ...i, location } : i))); // 反映を待たず即表示
    const { error } = await supabase
      .from('equipment')
      .update({ location, updated_at: new Date().toISOString() })
      .eq('id', item.id);
    if (error) {
      alert(`更新に失敗しました： ${error.message}`);
      fetchItems();
    }
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    const payload: Record<string, any> = { updated_at: new Date().toISOString() };
    if (editForm.name !== undefined) payload.name = editForm.name;
    if (editForm.quantity !== undefined) payload.quantity = editForm.quantity;
    if (editForm.notes !== undefined) payload.notes = editForm.notes || null;

    const { error } = await supabase.from('equipment').update(payload).eq('id', editingId);
    if (error) {
      alert(`更新に失敗しました： ${error.message}`);
      return;
    }
    setEditingId(null);
    fetchItems();
  };

  const handleDelete = async (item: Equipment) => {
    const confirmed = window.confirm(`「${item.name}」を削除します。よろしいですか？`);
    if (!confirmed) return;
    const { error } = await supabase.from('equipment').delete().eq('id', item.id);
    if (error) {
      alert(`削除に失敗しました： ${error.message}`);
      return;
    }
    fetchItems();
  };

  const handleExportExcel = async () => {
    if (filteredItems.length === 0) {
      alert('出力する備品がありません。');
      return;
    }
    const XLSX = await import('xlsx');
    const rows = filteredItems.map(i => ({
      '品名': i.name,
      '数量': i.quantity,
      '現在地': LOCATION_LABELS[i.location],
      '備考': i.notes || '',
      '最終更新': new Date(i.updated_at).toLocaleString('ja-JP'),
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet['!cols'] = [{ wch: 26 }, { wch: 8 }, { wch: 14 }, { wch: 32 }, { wch: 20 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, CATEGORY_LABELS[activeCategory]);
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `備品リスト_${CATEGORY_LABELS[activeCategory]}_${dateStr}.xlsx`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      <div>
        <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 900, color: '#0B1F3A', letterSpacing: '0.3px' }}>📦 備品管理</h2>
        <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: '#64748b' }}>Suivi du matériel par type de réunion et de son emplacement actuel.</p>
      </div>

      {/* ONGLETS DE CATÉGORIE */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', backgroundColor: '#f1f5f9', padding: '4px', borderRadius: '10px', width: 'fit-content' }}>
        {CATEGORY_ORDER.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            style={{
              padding: '8px 20px',
              borderRadius: '8px',
              border: 'none',
              fontWeight: 'bold',
              fontSize: '13px',
              cursor: 'pointer',
              backgroundColor: activeCategory === cat ? '#00A3E0' : 'transparent',
              color: activeCategory === cat ? '#fff' : '#475569',
              transition: 'all 0.2s',
            }}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* BARRE D'OUTILS */}
      <div style={{ backgroundColor: '#fff', padding: '16px 24px', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
        <input
          type="text"
          placeholder="🔍 品名・備考で検索..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, maxWidth: '320px' }}
        />
        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={handleExportExcel} style={actionBtnStyle('#0B1F3A', '#F5C842')}><Download size={16} /> Excelに出力</button>
          <button onClick={() => setShowAddForm(v => !v)} style={actionBtnStyle('#00A3E0', '#fff')}><Plus size={16} /> 備品を追加</button>
        </div>
      </div>

      {/* FORMULAIRE D'AJOUT */}
      {showAddForm && (
        <div style={{ backgroundColor: '#f0f9ff', padding: '20px', borderRadius: '12px', border: '1px solid #bae6fd', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 2fr auto', gap: '12px', alignItems: 'end' }}>
          <div>
            <label style={labelStyle}>品名</label>
            <input type="text" placeholder="例：延長コード" style={inputStyle} value={newName} onChange={e => setNewName(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>数量</label>
            <input type="number" min={1} style={inputStyle} value={newQuantity} onChange={e => setNewQuantity(parseInt(e.target.value) || 1)} />
          </div>
          <div>
            <label style={labelStyle}>現在地</label>
            <select style={inputStyle} value={newLocation} onChange={e => setNewLocation(e.target.value as EquipmentLocation)}>
              {LOCATION_ORDER.map(loc => <option key={loc} value={loc}>{LOCATION_LABELS[loc]}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>備考（任意）</label>
            <input type="text" placeholder="例：田中さん保管中" style={inputStyle} value={newNotes} onChange={e => setNewNotes(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleAdd} style={{ padding: '10px 16px', backgroundColor: '#10b981', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>追加</button>
            <button onClick={() => setShowAddForm(false)} style={{ padding: '10px', backgroundColor: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '8px', cursor: 'pointer' }}><X size={16} /></button>
          </div>
        </div>
      )}

      {/* TABLEAU */}
      <div style={{ backgroundColor: '#fff', borderRadius: '16px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
            <thead>
              <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569' }}>
                <th style={{ padding: '12px' }}>品名</th>
                <th style={{ padding: '12px', textAlign: 'center' }}>数量</th>
                <th style={{ padding: '12px' }}>現在地</th>
                <th style={{ padding: '12px' }}>備考</th>
                <th style={{ padding: '12px' }}>最終更新</th>
                <th style={{ padding: '12px', textAlign: 'center' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map(item => {
                const isEditing = editingId === item.id;
                const loc = LOCATION_COLORS[item.location];
                return (
                  <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px', fontWeight: 'bold', color: '#0B1F3A' }}>
                      {isEditing ? (
                        <input style={{ ...inputStyle, padding: '4px' }} value={editForm.name ?? ''} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
                      ) : item.name}
                    </td>
                    <td style={{ padding: '12px', textAlign: 'center' }}>
                      {isEditing ? (
                        <input type="number" min={1} style={{ ...inputStyle, padding: '4px', textAlign: 'center' }} value={editForm.quantity ?? 1} onChange={e => setEditForm({ ...editForm, quantity: parseInt(e.target.value) || 1 })} />
                      ) : item.quantity}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <select
                        value={item.location}
                        onChange={e => handleLocationChange(item, e.target.value as EquipmentLocation)}
                        style={{ padding: '6px 10px', borderRadius: '6px', border: 'none', fontWeight: 'bold', fontSize: '12px', cursor: 'pointer', backgroundColor: loc.bg, color: loc.text }}
                      >
                        {LOCATION_ORDER.map(l => <option key={l} value={l}>{LOCATION_LABELS[l]}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '12px', color: '#475569' }}>
                      {isEditing ? (
                        <input style={{ ...inputStyle, padding: '4px' }} value={editForm.notes ?? ''} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} />
                      ) : (item.notes || '—')}
                    </td>
                    <td style={{ padding: '12px', color: '#94a3b8', fontSize: '12px' }}>
                      {new Date(item.updated_at).toLocaleDateString('ja-JP')}
                    </td>
                    <td style={{ padding: '12px', textAlign: 'center' }}>
                      {isEditing ? (
                        <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                          <button onClick={handleSaveEdit} style={{ padding: '6px', backgroundColor: '#10b981', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}><Check size={14} /></button>
                          <button onClick={() => setEditingId(null)} style={{ padding: '6px', backgroundColor: '#ef4444', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}><X size={14} /></button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                          <button onClick={() => { setEditingId(item.id); setEditForm(item); }} style={{ padding: '6px 10px', backgroundColor: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Edit2 size={12} /> 編集
                          </button>
                          <button onClick={() => handleDelete(item)} style={{ padding: '6px 10px', backgroundColor: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Trash2 size={12} /> 削除
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && filteredItems.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: '#94a3b8', fontStyle: 'italic' }}>
                    {items.length === 0 ? `「${CATEGORY_LABELS[activeCategory]}」に登録されている備品はまだありません。` : '該当する備品が見つかりません。'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const actionBtnStyle = (bg: string, color: string) => ({
  display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px',
  backgroundColor: bg, color, border: 'none', borderRadius: '8px',
  fontWeight: '900' as const, fontSize: '13px', cursor: 'pointer',
});
const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', color: '#334155', fontSize: '13px', boxSizing: 'border-box' as const, outline: 'none' };
const labelStyle = { display: 'block', fontSize: '11px', color: '#64748b', marginBottom: '4px', fontWeight: 'bold' as const };
