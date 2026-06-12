'use client';

import { Component, type ReactNode } from 'react';

interface AvatarErrorBoundaryProps {
  onError: () => void;
  children: ReactNode;
}

/**
 * Boundary minimale per la scena 3D: in R3F v9 gli errori di render propagano
 * al tree React padre — qui si notifica il parent (→ fallback 2D permanente)
 * e si smette di renderizzare i figli. Nessuna dipendenza nuova.
 */
export class AvatarErrorBoundary extends Component<AvatarErrorBoundaryProps, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(): void {
    this.props.onError();
  }

  render(): ReactNode {
    return this.state.hasError ? null : this.props.children;
  }
}
