import type { PaletteId } from '../types';

const PALETTES: { id: PaletteId; title: string }[] = [
  { id: 'lavender', title: '淡紫' },
  { id: 'amber', title: '琥珀' },
  { id: 'ice', title: '冰蓝' },
  { id: 'mint', title: '薄荷' },
];

interface Props {
  palette: PaletteId;
  onChange: (p: PaletteId) => void;
}

export default function PaletteSelector({ palette, onChange }: Props) {
  return (
    <div className="palette-group">
      {PALETTES.map(p => (
        <div
          key={p.id}
          className={`palette-dot ${p.id}${palette === p.id ? ' active' : ''}`}
          title={p.title}
          onClick={() => onChange(p.id)}
        />
      ))}
    </div>
  );
}
