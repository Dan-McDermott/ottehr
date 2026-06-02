import Oystehr, { User } from '@oystehr/sdk';
import { Account } from 'fhir/r4b';
import { NOT_AUTHORIZED, Secrets } from 'utils';
import { getUser, userHasAccessToPatient, ZambdaInput } from '../../shared';

export interface BasePaymentManagementInput {
  secrets: Secrets | null;
  token: string;
  beneficiaryPatientId: string;
  payorProfile: string;
}

export const getBillingAccountForPatient = async (
  patientId: string,
  oystehrClient: Oystehr
): Promise<Account | undefined> => {
  const accounts = await oystehrClient.fhir.search<Account>({
    resourceType: 'Account',
    params: [
      {
        name: 'patient',
        value: `Patient/${patientId}`,
      },
      {
        name: 'status',
        value: 'active',
      },
      {
        name: 'type',
        value: 'PBILLACCT',
      },
    ],
  });
  return accounts.unbundle()[0];
};

interface PatientAccountCheckInput {
  beneficiaryPatientId: string;
  secrets: Secrets | null;
  zambdaInput: ZambdaInput;
}
export const validateUserHasAccessToPatientAccount = async (
  input: PatientAccountCheckInput,
  oystehrClient: Oystehr
): Promise<User> => {
  const { beneficiaryPatientId, secrets, zambdaInput } = input;
  const authorization = zambdaInput.headers.Authorization;
  if (!authorization) {
    console.log('authorization header not found');
    throw NOT_AUTHORIZED;
  }
  const user = await getUser(authorization.replace('Bearer ', ''), secrets);
  const userAccess = await userHasAccessToPatient(user, beneficiaryPatientId, oystehrClient);
  if (!userAccess) {
    console.log('no user access to patient');
    throw NOT_AUTHORIZED;
  }
  return user;
};
