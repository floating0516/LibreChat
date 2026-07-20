// ThemeSelector.spec.tsx
import 'test/matchMedia.mock';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import { RecoilRoot } from 'recoil';
import { InterfaceStyleSelector, ThemeSelector } from './Selectors';

describe('ThemeSelector', () => {
  let mockOnChange;

  beforeEach(() => {
    mockOnChange = jest.fn();
  });

  it('renders correctly', () => {
    global.ResizeObserver = class MockedResizeObserver {
      observe = jest.fn();
      unobserve = jest.fn();
      disconnect = jest.fn();
    };
    const { getByText, getByRole } = render(
      <RecoilRoot>
        <ThemeSelector theme="system" onChange={mockOnChange} />
      </RecoilRoot>,
    );

    expect(getByText('Theme')).toBeInTheDocument();
    const dropdownButton = getByRole('combobox');
    expect(dropdownButton).toHaveTextContent('System');
  });

  it('calls onChange when the select value changes', async () => {
    global.ResizeObserver = class MockedResizeObserver {
      observe = jest.fn();
      unobserve = jest.fn();
      disconnect = jest.fn();
    };
    const { getByText, getByTestId } = render(
      <RecoilRoot>
        <ThemeSelector theme="system" onChange={mockOnChange} />
      </RecoilRoot>,
    );

    expect(getByText('Theme')).toBeInTheDocument();

    const dropdownButton = getByTestId('theme-selector');

    fireEvent.click(dropdownButton);

    const darkOption = getByText('Dark');
    fireEvent.click(darkOption);

    await waitFor(() => {
      expect(mockOnChange).toHaveBeenCalledWith('dark');
    });
  });
});

describe('InterfaceStyleSelector', () => {
  it('renders the selected style as an accessible segmented control', () => {
    const onChange = jest.fn();
    render(
      <RecoilRoot>
        <InterfaceStyleSelector interfaceStyle="claude" onChange={onChange} />
      </RecoilRoot>,
    );

    expect(screen.getByRole('radiogroup', { name: 'Interface style' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Claude' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'ChatGPT' })).toHaveAttribute('aria-checked', 'false');
  });

  it('selects another interface style', () => {
    const onChange = jest.fn();
    render(
      <RecoilRoot>
        <InterfaceStyleSelector interfaceStyle="default" onChange={onChange} />
      </RecoilRoot>,
    );

    fireEvent.click(screen.getByRole('radio', { name: 'ChatGPT' }));
    expect(onChange).toHaveBeenCalledWith('chatgpt');
  });
});
