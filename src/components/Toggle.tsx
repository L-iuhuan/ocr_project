interface Props {
  on: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}

export default function Toggle({ on, onChange, disabled }: Props) {
  return (
    <button
      className={`tgl${on ? ' on' : ''}`}
      onClick={() => !disabled && onChange(!on)}
      disabled={disabled}
      type="button"
      style={disabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
    >
      <div className="knob" />
    </button>
  );
}
