export interface GetPatientBalancesZambdaInput {
  patientId: string;
}

export interface GetPatientBalancesZambdaOutput {
  totalBalanceCents: number;
  pendingPaymentCents: number;
  encounters: {
    encounterId: string;
    encounterDate: string;
    appointmentId: string;
    patientBalanceCents: number;
  }[];
}
