import React from 'react';

export default function Toast({ toast }) {
  if (!toast) return null;
  const color = toast.tipo === 'error' ? 'var(--danger)' : toast.tipo === 'success' ? 'var(--success)' : 'var(--senati-blue)';
  const icono = toast.tipo === 'error' ? 'fa-exclamation-circle' : toast.tipo === 'success' ? 'fa-check-circle' : 'fa-info-circle';
  return (
    <div className="alert-box" style={{ borderLeftColor: color }} role="status">
      <i className={`fas ${icono}`} style={{ color }}></i>
      <span>{toast.msg}</span>
    </div>
  );
}
