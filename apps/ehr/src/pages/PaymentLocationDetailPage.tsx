import CheckIcon from '@mui/icons-material/Check';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import EmailIcon from '@mui/icons-material/Email';
import FaxIcon from '@mui/icons-material/Fax';
import PhoneIcon from '@mui/icons-material/Phone';
import { Box, Chip, CircularProgress, Paper, Tooltip, Typography } from '@mui/material';
import { ReactElement, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BILLING_URL } from 'src/App';
import CustomBreadcrumbs from 'src/components/CustomBreadcrumbs';
import PageContainer from 'src/layout/PageContainer';
import { usePaymentLocationsQuery } from 'src/rcm/state/payments/payments.queries';

function CopyableValue({ label, value }: { label: string; value: string | undefined }): ReactElement {
  const [copied, setCopied] = useState(false);

  const handleCopy = (): void => {
    if (!value) return;
    void navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, py: 0.5 }}>
      <Typography variant="body2" color="text.secondary" sx={{ width: 160, flexShrink: 0 }}>
        {label}
      </Typography>
      {value ? (
        <Tooltip title={copied ? 'Copied!' : 'Click to copy'}>
          <Typography
            variant="body2"
            onClick={handleCopy}
            sx={{
              cursor: 'pointer',
              userSelect: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              fontFamily: 'monospace',
              fontSize: '0.85rem',
            }}
          >
            {value}
            {copied ? (
              <CheckIcon sx={{ fontSize: 14, color: 'success.main' }} />
            ) : (
              <ContentCopyIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
            )}
          </Typography>
        </Tooltip>
      ) : (
        <Typography variant="body2" color="text.disabled">
          —
        </Typography>
      )}
    </Box>
  );
}

const TELECOM_ICONS: Record<string, ReactElement> = {
  phone: <PhoneIcon sx={{ fontSize: 16, color: 'text.secondary' }} />,
  fax: <FaxIcon sx={{ fontSize: 16, color: 'text.secondary' }} />,
  email: <EmailIcon sx={{ fontSize: 16, color: 'text.secondary' }} />,
};

export default function PaymentLocationDetailPage(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const { data: locations, isLoading } = usePaymentLocationsQuery();

  const paymentLocation = locations?.find((pl) => pl.location.id === id);

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!paymentLocation) {
    return (
      <PageContainer tabTitle="Payment Location">
        <>
          <CustomBreadcrumbs
            chain={[
              { link: '/admin', children: 'Admin' },
              { link: BILLING_URL, children: 'Billing Configuration' },
              { link: `${BILLING_URL}/payment-locations`, children: 'Payment Locations' },
              { link: '#', children: 'Not Found' },
            ]}
          />
          <Paper sx={{ padding: 3, marginTop: 2 }}>
            <Typography color="text.secondary">Location not found.</Typography>
          </Paper>
        </>
      </PageContainer>
    );
  }

  const { location, supportsVirtualVisits } = paymentLocation;

  const address = location.address;
  const addressLines: string[] = [];
  if (address?.line) addressLines.push(...address.line);
  const cityStateZip = [address?.city, address?.state, address?.postalCode].filter(Boolean).join(', ');
  if (cityStateZip) addressLines.push(cityStateZip);
  if (address?.country && address.country !== 'US' && address.country !== 'USA') {
    addressLines.push(address.country);
  }

  return (
    <PageContainer tabTitle="Payment Location">
      <>
        <CustomBreadcrumbs
          chain={[
            { link: '/admin', children: 'Admin' },
            { link: BILLING_URL, children: 'Billing Configuration' },
            { link: `${BILLING_URL}/payment-locations`, children: 'Payment Locations' },
            { link: '#', children: location.name || 'Unnamed Location' },
          ]}
        />
        <Paper sx={{ padding: 3, marginTop: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              {location.name || 'Unnamed Location'}
            </Typography>
            {supportsVirtualVisits && (
              <Chip
                label="Virtual Visits Supported"
                size="small"
                sx={{ backgroundColor: '#e8f5e9', color: '#2e7d32', fontWeight: 500 }}
              />
            )}
          </Box>

          <Box sx={{ mb: 2 }}>
            <CopyableValue label="Location ID" value={location.id} />
          </Box>

          {/* Contact & Address */}
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
              Contact & Address
            </Typography>

            {addressLines.length > 0 ? (
              <Box sx={{ mb: 1.5 }}>
                {addressLines.map((line, i) => (
                  <Typography key={i} variant="body2">
                    {line}
                  </Typography>
                ))}
              </Box>
            ) : (
              <Typography variant="body2" color="text.disabled" sx={{ mb: 1.5 }}>
                No address on file
              </Typography>
            )}

            {location.telecom && location.telecom.length > 0 ? (
              location.telecom.map((t, i) => (
                <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                  {TELECOM_ICONS[t.system ?? ''] ?? null}
                  <Typography variant="body2">{t.value}</Typography>
                  {t.use && (
                    <Typography variant="caption" color="text.secondary">
                      ({t.use})
                    </Typography>
                  )}
                </Box>
              ))
            ) : (
              <Typography variant="body2" color="text.disabled">
                No telecom on file
              </Typography>
            )}
          </Paper>
        </Paper>
      </>
    </PageContainer>
  );
}
