import { LoadingButton } from '@mui/lab';
import { CircularProgress, FormLabel, TextField } from '@mui/material';
import { Box } from '@mui/system';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { AddCreditCardFormHandle } from 'ui-components';
import { dataTestIds } from '../../../helpers/data-test-ids';

// TODO(W2.1): swap this stub for the real CipherPay-based AddCreditCardForm
// from packages/ui-components once W2.1 ships. The stub renders plain text
// inputs (NOT PCI-safe — local/dev only) and emits a fixture encrypted blob to
// the W1.1 `rh-payment-methods-setup` zambda so the rest of the paperwork
// continue/save plumbing can be exercised end-to-end.
const FIXTURE_ENCRYPTED_CARD_DATA = 'TEST_RH_CIPHERPAY_ENCRYPTED_FIXTURE';

type RHCreditCardFormProps = {
  disabled: boolean;
  isSaving: boolean;
  onCardChange?: () => void;
  // Encrypts the entered card and persists it via the RH setup zambda.
  // Returns a paymentMethodId on success which the caller wires as the
  // newly-selected default card.
  setupCard: (params: {
    encryptedCardData: string;
    last4?: string;
    brand?: string;
  }) => Promise<{ paymentMethodId: string }>;
  selectPaymentMethod: (paymentMethodId: string) => void | Promise<void>;
};

const detectBrand = (cardNumber: string): string | undefined => {
  const digits = cardNumber.replace(/\s+/g, '');
  if (/^4/.test(digits)) return 'visa';
  if (/^5[1-5]/.test(digits)) return 'mastercard';
  if (/^3[47]/.test(digits)) return 'amex';
  if (/^6(?:011|5)/.test(digits)) return 'discover';
  return undefined;
};

export const RHAddCreditCardFormStub = forwardRef<AddCreditCardFormHandle, RHCreditCardFormProps>((props, ref) => {
  const { disabled, isSaving, onCardChange, setupCard, selectPaymentMethod } = props;

  const [number, setNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [saveError, setSaveError] = useState<string | undefined>(undefined);

  const saveStateRef = useRef<'pending' | 'saving' | 'saved'>('pending');

  const cardComplete = number.replace(/\s+/g, '').length >= 13 && /\d{2}\/\d{2}/.test(expiry) && cvc.length >= 3;

  const saveCard = async (): Promise<{ success: boolean; error?: string }> => {
    if (saveStateRef.current === 'saved') {
      return { success: true };
    }
    if (saveStateRef.current === 'saving') {
      const error = 'Card save already in progress';
      setSaveError(error);
      return { success: false, error };
    }
    if (!cardComplete) {
      const error = 'Card information is incomplete';
      setSaveError(error);
      return { success: false, error };
    }

    saveStateRef.current = 'saving';
    try {
      const digits = number.replace(/\s+/g, '');
      const last4 = digits.slice(-4);
      const brand = detectBrand(digits);
      const { paymentMethodId } = await setupCard({
        encryptedCardData: FIXTURE_ENCRYPTED_CARD_DATA,
        last4,
        brand,
      });
      await selectPaymentMethod(paymentMethodId);
      saveStateRef.current = 'saved';
      setSaveError(undefined);
      setNumber('');
      setExpiry('');
      setCvc('');
      return { success: true };
    } catch (err) {
      console.error('[RHAddCreditCardFormStub] error during card save:', err);
      saveStateRef.current = 'pending';
      const errorMessage = err instanceof Error ? err.message : 'Failed to save card data';
      setSaveError(errorMessage);
      return { success: false, error: errorMessage };
    }
  };

  useImperativeHandle(ref, () => ({
    getCardState: () => ({ complete: cardComplete, error: saveError ? { message: saveError } : undefined }),
    saveCard,
  }));

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        backgroundColor: 'rgba(244, 246, 248, 1)',
        borderRadius: 1,
        padding: 2,
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      <TextField
        label="Card number"
        size="small"
        disabled={disabled || isSaving}
        value={number}
        onChange={(e) => {
          setNumber(e.target.value);
          setSaveError(undefined);
          onCardChange?.();
          if (saveStateRef.current === 'saved') {
            saveStateRef.current = 'pending';
          }
        }}
        inputProps={{ 'data-testid': dataTestIds.rhCardNumberInput, inputMode: 'numeric', autoComplete: 'cc-number' }}
      />
      <Box sx={{ display: 'flex', gap: 2 }}>
        <TextField
          label="MM/YY"
          size="small"
          disabled={disabled || isSaving}
          value={expiry}
          onChange={(e) => {
            setExpiry(e.target.value);
            setSaveError(undefined);
            onCardChange?.();
          }}
          inputProps={{ 'data-testid': dataTestIds.rhCardExpiryInput, autoComplete: 'cc-exp' }}
          sx={{ flex: 1 }}
        />
        <TextField
          label="CVC"
          size="small"
          disabled={disabled || isSaving}
          value={cvc}
          onChange={(e) => {
            setCvc(e.target.value);
            setSaveError(undefined);
            onCardChange?.();
          }}
          inputProps={{ 'data-testid': dataTestIds.rhCardCvcInput, inputMode: 'numeric', autoComplete: 'cc-csc' }}
          sx={{ flex: 1 }}
        />
      </Box>
      {saveError && (
        <FormLabel error sx={{ color: '#d32f2f', fontSize: '0.95rem' }}>
          {saveError}
        </FormLabel>
      )}
      {isSaving && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CircularProgress size={20} />
          <FormLabel>Saving card...</FormLabel>
        </Box>
      )}
      {/* No add button in intake; the paperwork "Continue" button drives saveCard. */}
      <LoadingButton sx={{ display: 'none' }} loading={isSaving} type="button">
        Add card
      </LoadingButton>
    </Box>
  );
});

RHAddCreditCardFormStub.displayName = 'RHAddCreditCardFormStub';
