import Oystehr, { SearchParam } from '@oystehr/sdk';
import { PaymentNotice } from 'fhir/r4b';
import { DateTime } from 'luxon';
import { CashPaymentDTO, convertPaymentNoticeListToCashPaymentDTOs, PatientPaymentDTO } from 'utils';
import { FINIX_TRANSFER_ID_SYSTEM } from '../../shared';

interface GetPaymentsForEncounterInput {
  oystehrClient: Oystehr;
  encounterId: string;
}

interface GetPaymentsForPatientInput {
  oystehrClient: Oystehr;
  patientId: string;
  encounterId?: string;
}

const buildFinixCardPaymentsFromNotices = (paymentNotices: PaymentNotice[]): PatientPaymentDTO[] => {
  return paymentNotices.flatMap((paymentNotice) => {
    const finixTransferId = paymentNotice.identifier?.find((id) => id.system === FINIX_TRANSFER_ID_SYSTEM)?.value;
    if (!finixTransferId) {
      return [];
    }
    const dateISO = DateTime.fromISO(paymentNotice.created).toISO();
    if (!dateISO || !paymentNotice.id) {
      return [];
    }
    return [
      {
        paymentMethod: 'card' as const,
        finixTransferId,
        amountInCents: Math.round((paymentNotice.amount.value ?? 0) * 100),
        fhirPaymentNotificationId: paymentNotice.id,
        dateISO,
      },
    ];
  });
};

const buildPaymentDTOs = (fhirPaymentNotices: PaymentNotice[], encounterId?: string): PatientPaymentDTO[] => {
  const cardPayments = buildFinixCardPaymentsFromNotices(fhirPaymentNotices).slice(0, 20);

  const cashPayments: CashPaymentDTO[] = convertPaymentNoticeListToCashPaymentDTOs(fhirPaymentNotices, encounterId);

  const deDuplicatedCashPayments = cashPayments.filter((cashPayment) => {
    if (!cashPayment.fhirPaymentNotificationId) {
      return true;
    }
    return !cardPayments.some(
      (cardPayment) => cardPayment.fhirPaymentNotificationId === cashPayment.fhirPaymentNotificationId
    );
  });

  return [...cardPayments, ...deDuplicatedCashPayments].sort((a, b) => {
    return DateTime.fromISO(b.dateISO).toMillis() - DateTime.fromISO(a.dateISO).toMillis();
  });
};

export const getPaymentsForEncounter = async (input: GetPaymentsForEncounterInput): Promise<PatientPaymentDTO[]> => {
  const { oystehrClient, encounterId } = input;

  const fhirPaymentNotices: PaymentNotice[] = (
    await oystehrClient.fhir.search<PaymentNotice>({
      resourceType: 'PaymentNotice',
      params: [
        {
          name: 'request',
          value: `Encounter/${encounterId}`,
        },
      ],
    })
  ).unbundle();

  return buildPaymentDTOs(fhirPaymentNotices, encounterId);
};

export const getPaymentsForPatient = async (input: GetPaymentsForPatientInput): Promise<PatientPaymentDTO[]> => {
  const { oystehrClient, patientId, encounterId } = input;

  const params: SearchParam[] = encounterId
    ? [{ name: 'request', value: `Encounter/${encounterId}` }]
    : [{ name: 'request.patient._id', value: patientId }];

  const fhirPaymentNotices: PaymentNotice[] = (
    await oystehrClient.fhir.search<PaymentNotice>({
      resourceType: 'PaymentNotice',
      params,
    })
  ).unbundle();

  return buildPaymentDTOs(fhirPaymentNotices, encounterId);
};
