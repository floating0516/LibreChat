import React from 'react';
import { render, screen } from '@testing-library/react';
import TokenUsage from '../TokenUsage';

const mockView = {
  usedTokens: 500,
  maxTokens: 1000 as number | undefined,
  percent: 50,
  isEstimate: false,
  snapshot: null,
  snapshotActive: false,
  branchTotals: {},
  branchUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, costKnown: false },
  totalUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, costKnown: false },
  hasUsage: false,
  branchCost: 0,
  totalCost: 0,
  liveTokens: 0,
};

let mockStartupConfig = {
  interface: { contextUsage: true, contextCost: false },
};

jest.mock('~/hooks/Chat/useTokenUsage', () => ({
  __esModule: true,
  default: () => mockView,
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: mockStartupConfig }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('@librechat/client', () => ({
  TooltipAnchor: ({ render }: { render: React.ReactNode }) => render,
}));

jest.mock('../TokenUsage/Gauge', () => ({
  __esModule: true,
  default: () => <span data-testid="gauge" />,
}));

jest.mock('../TokenUsage/Breakdown', () => ({
  __esModule: true,
  default: () => <div data-testid="breakdown" />,
}));

describe('TokenUsage', () => {
  beforeEach(() => {
    mockView.usedTokens = 500;
    mockView.maxTokens = 1000;
    mockView.percent = 50;
    mockStartupConfig = { interface: { contextUsage: true, contextCost: false } };
  });

  it('stays hidden during normal context usage', () => {
    render(<TokenUsage index={0} conversation={null} isSubmitting={false} />);
    expect(screen.queryByTestId('token-usage')).not.toBeInTheDocument();
  });

  it('appears once context usage reaches the warning threshold', () => {
    mockView.usedTokens = 750;
    mockView.percent = 75;
    render(<TokenUsage index={0} conversation={null} isSubmitting={false} />);
    expect(screen.getByTestId('token-usage')).toBeInTheDocument();
  });

  it('remains available below the threshold when cost reporting is enabled', () => {
    mockStartupConfig = { interface: { contextUsage: true, contextCost: true } };
    render(<TokenUsage index={0} conversation={null} isSubmitting={false} />);
    expect(screen.getByTestId('token-usage')).toBeInTheDocument();
  });

  it('stays hidden without a known context limit when cost reporting is disabled', () => {
    mockView.maxTokens = undefined;
    mockView.percent = 0;
    render(<TokenUsage index={0} conversation={null} isSubmitting={false} />);
    expect(screen.queryByTestId('token-usage')).not.toBeInTheDocument();
  });
});
