import { LoadingButton } from '@mui/lab';
import { Checkbox, CircularProgress, FormLabel, TextField } from '@mui/material';
import { Box } from '@mui/system';
import { ChangeEvent, forwardRef, useImperativeHandle, useRef, useState } from 'react';
import {
  detectCardBrand,
  encryptCardDataForCipherPay,
  getLastFour,
  isValidCardNumber,
  isValidCvv,
  isValidExpirationMonth,
  isValidExpirationYear,
  normaliseCardNumber,
  validateCardData,
} from '../utils/cipherpayEncryption';
import type { AddCreditCardFormHandle } from './AddCreditCardForm';

// Rectangle Health (v3) CipherPay-encrypted credit-card form. Captures card
// data in plain inputs, encrypts it client-side via cipherpayEncryption, then
// delegates persistence to the consumer-supplied `setupCard` callback (which
// wraps the `rh-payment-methods-setup` zambda). Implements the same handle
// shape as the Stripe `AddCreditCardForm` so callers can swap form types
// without changing their imperative-handle wiring.
type RHCreditCardFormProps = {
  disabled: boolean;
  isSaving?: boolean;
  condition?: string;
  setupCard: (params: {
    encryptedCardData: string;
    last4?: string;
    brand?: string;
  }) => Promise<{ paymentMethodId: string }>;
  selectPaymentMethod: (paymentMethodId: string) => void | Promise<void>;
  onCardChange?: () => void;
  showAddButton?: boolean;
};

interface CardFields {
  cardNumber: string;
  expirationMonth: string;
  expirationYear: string;
  cvv: string;
}

const EMPTY_FIELDS: CardFields = { cardNumber: '', expirationMonth: '', expirationYear: '', cvv: '' };

const isComplete = (fields: CardFields): boolean =>
  isValidCardNumber(fields.cardNumber) &&
  isValidExpirationMonth(fields.expirationMonth) &&
  isValidExpirationYear(fields.expirationYear) &&
  isValidCvv(fields.cvv);

export const AddRHCreditCardForm = forwardRef<AddCreditCardFormHandle, RHCreditCardFormProps>((props, ref) => {
  const {
    disabled,
    isSaving: isSavingProp,
    condition,
    setupCard,
    selectPaymentMethod,
    onCardChange,
    showAddButton = false,
  } = props;

  const [fields, setFields] = useState<CardFields>(EMPTY_FIELDS);
  const [conditionAccepted, setConditionAccepted] = useState<boolean>(false);
  const [internalSaving, setInternalSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const saveStateRef = useRef<'pending' | 'saving' | 'saved'>('pending');

  const isSaving = isSavingProp ?? internalSaving;

  const handleFieldChange =
    (key: keyof CardFields) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
      const value = event.target.value;
      const next = key === 'cardNumber' ? normaliseCardNumber(value) : value.replace(/\D/g, '');
      setFields((prev) => ({ ...prev, [key]: next }));
      setSaveError(undefined);
      onCardChange?.();
      if (saveStateRef.current === 'saved') {
        saveStateRef.current = 'pending';
      }
    };

  const saveCard = async (): Promise<{ success: boolean; error?: string }> => {
    if (saveStateRef.current === 'saved') {
      return { success: true };
    }
    if (saveStateRef.current === 'saving') {
      const error = 'Card save already in progress';
      setSaveError(error);
      return { success: false, error };
    }
    const validation = validateCardData(fields);
    if (!validation.valid) {
      const error = validation.error ?? 'Invalid card data';
      setSaveError(error);
      return { success: false, error };
    }

    saveStateRef.current = 'saving';
    setInternalSaving(true);
    try {
      const encryptedCardData = await encryptCardDataForCipherPay(fields);
      const last4 = getLastFour(fields.cardNumber);
      const brand = detectCardBrand(fields.cardNumber);
      const { paymentMethodId } = await setupCard({ encryptedCardData, last4, brand });
      if (!paymentMethodId) {
        throw new Error('Rectangle Health did not return a payment method id');
      }
      await selectPaymentMethod(paymentMethodId);
      setFields(EMPTY_FIELDS);
      saveStateRef.current = 'saved';
      setSaveError(undefined);
      return { success: true };
    } catch (err) {
      console.error('[AddRHCreditCardForm] Failed to save card:', err);
      saveStateRef.current = 'pending';
      const errorMessage = err instanceof Error ? err.message : 'Failed to save card data';
      setSaveError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setInternalSaving(false);
    }
  };

  useImperativeHandle(ref, () => ({
    getCardState: () => ({
      complete: isComplete(fields),
      error: saveError ? { message: saveError } : undefined,
    }),
    saveCard,
  }));

  const fieldDisabled = disabled || isSaving;
  const cardComplete = isComplete(fields);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        alignItems: 'end',
        backgroundColor: 'rgba(244, 246, 248, 1)',
        borderRadius: 1,
        padding: 2,
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, width: '100%' }}>
        <TextField
          label="Card number"
          value={fields.cardNumber}
          onChange={handleFieldChange('cardNumber')}
          disabled={fieldDisabled}
          inputProps={{ inputMode: 'numeric', autoComplete: 'cc-number', maxLength: 19 }}
          fullWidth
          size="small"
        />
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <TextField
            label="MM"
            value={fields.expirationMonth}
            onChange={handleFieldChange('expirationMonth')}
            disabled={fieldDisabled}
            inputProps={{ inputMode: 'numeric', autoComplete: 'cc-exp-month', maxLength: 2 }}
            sx={{ flex: 1 }}
            size="small"
          />
          <TextField
            label="YYYY"
            value={fields.expirationYear}
            onChange={handleFieldChange('expirationYear')}
            disabled={fieldDisabled}
            inputProps={{ inputMode: 'numeric', autoComplete: 'cc-exp-year', maxLength: 4 }}
            sx={{ flex: 1 }}
            size="small"
          />
          <TextField
            label="CVV"
            value={fields.cvv}
            onChange={handleFieldChange('cvv')}
            disabled={fieldDisabled}
            inputProps={{ inputMode: 'numeric', autoComplete: 'cc-csc', maxLength: 4 }}
            sx={{ flex: 1 }}
            size="small"
          />
        </Box>
      </Box>
      {showAddButton && saveError && (
        <Box sx={{ width: '100%' }}>
          <FormLabel error sx={{ marginLeft: '12px', color: '#d32f2f', fontSize: '0.95rem' }}>
            {saveError}
          </FormLabel>
        </Box>
      )}
      {condition && (
        <Box sx={{ display: 'flex', minWidth: '100%', alignItems: 'center', gap: 1 }}>
          <Checkbox
            id="rh-condition-acceptance"
            checked={conditionAccepted}
            onChange={(e) => setConditionAccepted(e.target.checked)}
            disabled={isSaving}
          />
          <FormLabel htmlFor="rh-condition-acceptance">{condition}</FormLabel>
        </Box>
      )}
      {showAddButton && (
        <LoadingButton
          loading={isSaving}
          disabled={disabled || !cardComplete || Boolean(condition && !conditionAccepted)}
          variant="outlined"
          type="button"
          onClick={() => void saveCard()}
        >
          Add card
        </LoadingButton>
      )}
      {isSaving && !showAddButton && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CircularProgress size={20} />
          <FormLabel>Saving card...</FormLabel>
        </Box>
      )}
    </Box>
  );
});

AddRHCreditCardForm.displayName = 'AddRHCreditCardForm';
