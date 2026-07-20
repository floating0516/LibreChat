/* eslint-disable i18next/no-literal-string */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppearanceProvider, useAppearance } from '../AppearanceContext';

function AppearanceHarness() {
  const { interfaceStyle, setInterfaceStyle } = useAppearance();
  return (
    <div>
      <output>{interfaceStyle}</output>
      <button type="button" onClick={() => setInterfaceStyle('chatgpt')}>
        Apply ChatGPT
      </button>
    </div>
  );
}

describe('AppearanceProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-interface-style');
  });

  it('uses and applies the default style', async () => {
    render(
      <AppearanceProvider>
        <AppearanceHarness />
      </AppearanceProvider>,
    );

    expect(screen.getByText('default')).toBeInTheDocument();
    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute('data-interface-style', 'default');
    });
  });

  it('restores a supported stored style', async () => {
    localStorage.setItem('interface-style', 'claude');

    render(
      <AppearanceProvider>
        <AppearanceHarness />
      </AppearanceProvider>,
    );

    expect(screen.getByText('claude')).toBeInTheDocument();
    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute('data-interface-style', 'claude');
    });
  });

  it('persists and immediately applies a selected style', () => {
    render(
      <AppearanceProvider>
        <AppearanceHarness />
      </AppearanceProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Apply ChatGPT' }));

    expect(screen.getByText('chatgpt')).toBeInTheDocument();
    expect(localStorage.getItem('interface-style')).toBe('chatgpt');
    expect(document.documentElement).toHaveAttribute('data-interface-style', 'chatgpt');
  });

  it('rejects an unsupported stored style', async () => {
    localStorage.setItem('interface-style', 'unsupported');

    render(
      <AppearanceProvider>
        <AppearanceHarness />
      </AppearanceProvider>,
    );

    expect(screen.getByText('default')).toBeInTheDocument();
    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute('data-interface-style', 'default');
    });
  });
});
