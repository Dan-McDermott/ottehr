import Oystehr from '@oystehr/sdk';
import { captureException } from '@sentry/aws-serverless';
import { APIGatewayProxyResult } from 'aws-lambda';
import { Encounter, PaymentNotice } from 'fhir/r4b';
import {
  createOystehrClient,
  createPatientPaymentReceiptPdf,
  getAuth0Token,
  wrapHandler,
  ZambdaInput,
} from '../../../shared';
import { patchTaskStatus } from '../../helpers';
import { validateRequestParameters } from '../validateRequestParameters';

let oystehrToken: string;
let oystehr: Oystehr;
let taskId: string | undefined;

const ZAMBDA_NAME = 'sub-patient-payment-candid-sync-and-receipt';

export const index = wrapHandler(ZAMBDA_NAME, async (input: ZambdaInput): Promise<APIGatewayProxyResult> => {
  try {
    console.group('validateRequestParameters');
    const validatedParameters = validateRequestParameters(input);
    const { task, secrets } = validatedParameters;
    console.log('task ID', task.id);
    if (!task.id) {
      throw new Error('Task ID is required');
    }
    taskId = task.id;
    console.groupEnd();
    console.debug('validateRequestParameters success');

    if (!oystehrToken) {
      console.log('getting token');
      oystehrToken = await getAuth0Token(secrets);
    } else {
      console.log('already have token');
    }

    oystehr = createOystehrClient(oystehrToken, secrets);

    try {
      console.log('getting payment notice Id from the task');
      const paymentNoticeId =
        task.focus?.type === 'PaymentNotice' ? task.focus?.reference?.replace('PaymentNotice/', '') : undefined;
      console.log('payment notice ID parsed: ', paymentNoticeId);

      if (!paymentNoticeId) {
        console.log('no payment notice ID found on task');
        throw new Error('no payment notice ID found on task focus');
      }

      const encounterId = task.encounter?.reference?.split('/')[1];
      if (!encounterId) {
        console.log('no encounter ID found on task');
        throw new Error('no encounter ID found on task encounter');
      }

      console.log('fetching payment notice');
      const paymentNoticeSearchResult = await oystehr.fhir.search<PaymentNotice>({
        resourceType: 'PaymentNotice',
        params: [
          {
            name: '_id',
            value: paymentNoticeId,
          },
        ],
      });

      const paymentNotices = paymentNoticeSearchResult.unbundle();
      if (!paymentNotices || paymentNotices.length === 0) {
        throw new Error(`PaymentNotice ${paymentNoticeId} not found`);
      }

      const paymentNotice = paymentNotices[0];

      // Get patient ID from the encounter request
      const encounterRef = paymentNotice.request?.reference;
      if (!encounterRef) {
        throw new Error(`No encounter reference found on PaymentNotice ${paymentNoticeId}`);
      }

      const encounterSearchResult = await oystehr.fhir.search<Encounter>({
        resourceType: 'Encounter',
        params: [
          {
            name: '_id',
            value: encounterId,
          },
        ],
      });

      const encounters = encounterSearchResult.unbundle();
      if (!encounters || encounters.length === 0) {
        throw new Error(`Encounter ${encounterId} not found`);
      }

      const encounter = encounters[0] as Encounter;

      const patientId = encounter.subject?.reference?.replace('Patient/', '');
      if (!patientId) {
        throw new Error(`No patient reference found on Encounter ${encounterId}`);
      }

      let receiptPdfFailed = false;
      const errors: string[] = [];

      // Create patient payment receipt PDF
      try {
        console.time('receipt pdf creation');
        const receiptPdfInfo = await createPatientPaymentReceiptPdf({
          oystehr,
          encounterId,
          patientId,
          secrets,
          oystehrToken,
        });
        console.timeEnd('receipt pdf creation');
        console.log('Receipt PDF created:', receiptPdfInfo);
      } catch (error) {
        console.error(`Error creating receipt PDF: ${error}`);
        captureException(error);
        receiptPdfFailed = true;
        errors.push(`Receipt PDF creation failed: ${error}`);
      }

      console.log('making patch request to update task status');
      const taskStatus = receiptPdfFailed ? 'failed' : 'completed';
      const statusMessage = receiptPdfFailed ? errors.join('; ') : 'Receipt PDF created successfully';

      const patchedTask = await patchTaskStatus(
        { task: { id: task.id }, taskStatusToUpdate: taskStatus, statusReasonToUpdate: statusMessage },
        oystehr
      );

      const response = {
        taskStatus: patchedTask.status,
        statusReason: patchedTask.statusReason,
      };

      return {
        statusCode: 200,
        body: JSON.stringify(response),
      };
    } catch (error: unknown) {
      try {
        if (oystehr && taskId)
          await patchTaskStatus(
            { task: { id: taskId }, taskStatusToUpdate: 'failed', statusReasonToUpdate: JSON.stringify(error) },
            oystehr
          );
      } catch (patchError) {
        console.error('Error patching task status in top level catch:', patchError);
      }
      throw error;
    }
  } catch (error: unknown) {
    try {
      if (oystehr && taskId)
        await patchTaskStatus(
          { task: { id: taskId }, taskStatusToUpdate: 'failed', statusReasonToUpdate: JSON.stringify(error) },
          oystehr
        );
    } catch (patchError) {
      console.error('Error patching task status in top level catch:', patchError);
    }
    throw error;
  }
});
