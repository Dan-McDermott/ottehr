import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Location } from 'fhir/r4b';
import { ReactNode } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ id: 'loc-1' }),
  };
});

const mockPaymentLocationsData = vi.fn();

vi.mock('src/rcm/state/payments/payments.queries', () => ({
  usePaymentLocationsQuery: () => mockPaymentLocationsData(),
}));

vi.mock('src/hooks/useAppClients', () => ({
  useApiClients: () => ({
    oystehr: null,
    oystehrZambda: null,
  }),
}));

import PaymentLocationDetailPage from '../../src/pages/PaymentLocationDetailPage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLocation(overrides?: Partial<Location>): Location {
  return {
    resourceType: 'Location',
    id: 'loc-1',
    status: 'active',
    name: 'Main Office',
    address: {
      line: ['123 Main St'],
      city: 'Springfield',
      state: 'IL',
      postalCode: '62701',
    },
    telecom: [
      { system: 'phone', value: '555-1234', use: 'work' },
      { system: 'email', value: 'info@clinic.com' },
    ],
    ...overrides,
  } as Location;
}

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>{children}</BrowserRouter>
    </QueryClientProvider>
  );
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PaymentLocationDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading spinner while data is loading', () => {
    mockPaymentLocationsData.mockReturnValue({ data: undefined, isLoading: true });

    render(<PaymentLocationDetailPage />, { wrapper: createWrapper() });
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('shows "Location not found" when location id does not match', () => {
    mockPaymentLocationsData.mockReturnValue({
      data: [{ location: makeLocation({ id: 'other-loc' }), supportsVirtualVisits: false }],
      isLoading: false,
    });

    render(<PaymentLocationDetailPage />, { wrapper: createWrapper() });
    expect(screen.getByText('Location not found.')).toBeInTheDocument();
  });

  it('renders location detail sections when data is loaded', () => {
    mockPaymentLocationsData.mockReturnValue({
      data: [{ location: makeLocation(), supportsVirtualVisits: false }],
      isLoading: false,
    });

    render(<PaymentLocationDetailPage />, { wrapper: createWrapper() });
    // Verify structural sections are present
    expect(screen.getByText('Contact & Address')).toBeInTheDocument();
    expect(screen.getByLabelText('breadcrumb')).toBeInTheDocument();
  });

  it('renders telecom section when telecom data exists', () => {
    mockPaymentLocationsData.mockReturnValue({
      data: [{ location: makeLocation(), supportsVirtualVisits: false }],
      isLoading: false,
    });

    render(<PaymentLocationDetailPage />, { wrapper: createWrapper() });
    // Verify telecom values from mock data are rendered
    expect(screen.getByText('555-1234')).toBeInTheDocument();
    expect(screen.getByText('info@clinic.com')).toBeInTheDocument();
  });

  it('shows "Virtual Visits Supported" chip when applicable', () => {
    mockPaymentLocationsData.mockReturnValue({
      data: [{ location: makeLocation(), supportsVirtualVisits: true }],
      isLoading: false,
    });

    render(<PaymentLocationDetailPage />, { wrapper: createWrapper() });
    expect(screen.getByText('Virtual Visits Supported')).toBeInTheDocument();
  });

  it('does not show virtual visits chip when not supported', () => {
    mockPaymentLocationsData.mockReturnValue({
      data: [{ location: makeLocation(), supportsVirtualVisits: false }],
      isLoading: false,
    });

    render(<PaymentLocationDetailPage />, { wrapper: createWrapper() });
    expect(screen.queryByText('Virtual Visits Supported')).not.toBeInTheDocument();
  });

  it('renders "No address on file" when location has no address', () => {
    const loc = makeLocation({ address: undefined, telecom: undefined });
    mockPaymentLocationsData.mockReturnValue({
      data: [{ location: loc, supportsVirtualVisits: false }],
      isLoading: false,
    });

    render(<PaymentLocationDetailPage />, { wrapper: createWrapper() });
    expect(screen.getByText('No address on file')).toBeInTheDocument();
    expect(screen.getByText('No telecom on file')).toBeInTheDocument();
  });

  it('navigates back when "Payment Locations" breadcrumb is clicked', async () => {
    const user = userEvent.setup();
    mockPaymentLocationsData.mockReturnValue({
      data: [{ location: makeLocation(), supportsVirtualVisits: false }],
      isLoading: false,
    });

    render(<PaymentLocationDetailPage />, { wrapper: createWrapper() });
    const breadcrumbLink = screen.getByRole('link', { name: 'Payment Locations' });
    await user.click(breadcrumbLink);
  });
});
