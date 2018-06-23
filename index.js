"use strict";

var Promise = require('bluebird');

const AWS = require('aws-sdk');
const client = new AWS.DynamoDB.DocumentClient();

const qs = require('query-string');
const _ = require('lodash');

const s3_getObject = Promise.promisify(require('@deliverymanager/util').s3_getObject);
const lambda_invoke = Promise.promisify(require('@deliverymanager/util').lambda_invoke);

exports.handler = function(event, context, callback) {
  let resource;
  let group;
  let store_id;
  let order_id;
  let savecard;

  Promise.try(() => {
      console.log('event:', JSON.stringify(event, null, 2));
      resource = event.resource.substr(event.resource.lastIndexOf('/') + 1);
      console.log('resource:', resource);
      let body = event.queryStringParameters;
      console.log('body:', body);
      // let store_id = body.orderid.slice(0, 6);
      // let order_id = body.orderid.slice(16);

      if (resource === 'back' || resource === 'expiry') return Promise.resolve();
      else {
        store_id = body.merchantreference.slice(0, 6);
        order_id = body.merchantreference.slice(6, -10);
        group = body.group;

        if (order_id.indexOf('scard') !== -1) {
          savecard = true;
          order_id = order_id.replace('scard', '');
        }

        console.log('store_id:', store_id);
        console.log('order_id:', order_id);
        console.log('savecard:', savecard);

        return Promise.join(
          s3_getObject({
            Bucket: 'bankscred',
            Key: `${group}/${store_id}/ethniki/cred.json`
          }, {}),
          s3_getObject({
            Bucket: 'allgroups',
            Key: `${group}/${store_id}/storeAccount.json`
          }, {}),
          (cred, store) => {
            cred = JSON.parse(cred);
            console.log('cred:', cred);

            event.store = _.pick(JSON.parse(store), ['paymentGateways']);

            return lambda_invoke('ethniki_web_service', 'dev', null, {
                dts_reference: body.dts_reference,
                client: cred.client,
                password: cred.password,
                RequestType: 'hcc_auth',
                Amount: body.Amount,
                store_id: store_id,
                token: body.token
              })
              .then(res => res.success ? Promise.resolve(res) : Promise.reject(res));
          }
        );
      }
    })
    .then(body => {
      resource = body.status === '1' ? 'success' : 'failure';

      return order_id && resource === 'success' ?
        client.update({
          TableName: 'orders',
          Key: {
            store_id: store_id,
            order_id: order_id
          },
          UpdateExpression: 'set #status = :status, #payment_id = :payment_id, #MerchantReference = :MerchantReference, #selectedPaymentMethodID = :selectedPaymentMethodID, #payment_timestamp = :payment_timestamp',
          ConditionExpression: 'attribute_not_exists(#payment_id) AND attribute_exists(#order_id)',
          ExpressionAttributeNames: {
            '#order_id': 'order_id',
            '#payment_id': 'payment_id',
            '#MerchantReference': 'MerchantReference',
            '#status': 'status',
            '#selectedPaymentMethodID': 'selectedPaymentMethodID',
            '#payment_timestamp': 'payment_timestamp'
          },
          ExpressionAttributeValues: {
            ':payment_id': body.TransactionId,
            ':MerchantReference': body.MerchantReference,
            ':status': 'pending',
            ':selectedPaymentMethodID': 'ethniki',
            ':payment_timestamp': body.timestamp
          }
        }).promise() :
        // TODO: refund save card charge
        Promise.resolve({
          success: true
        })
        .then(res => res.success ? Promise.resolve() : Promise.reject(res));
    })
    .then(() => {
      console.log('RequestId SUCCESS');
      return Promise.resolve();
    })
    .catch(err => {
      resource = 'failure';

      console.log('err:', err);

      try {
        console.log('event.body:', qs.parse(event.body));
      } catch (e) {
        console.log('e');
        console.log('event:', event);
      }

      return Promise.resolve();
    })
    .then(() => {
      let h3 = 'Η συναλλαγή σας ';

      if (resource === 'success') h3 += 'πραγματοποιήθηκε επιτυχώς!';
      else if (resource === 'expiry') h3 += '';
      else if (resource === 'back') h3 += 'ακυρώθηκε επιτυχώς!';
      else h3 += 'απέτυχε!';

      context.succeed({
        statusCode: 200,
        // TODO: resource
        body: `<link rel="stylesheet" href="https://${event.store.paymentGateways.ethniki.url.replace('frame.html', '')}style.css">
            <div align="center">
                <span class="icon-${resource}" style="color: ${resource === 'success' ? 'lightgreen' : 'red'}; font-size: 200px; font-weight: bold;">
                </span>
              <h3>${h3}</h3>
              <p>Μπορείτε να κλείσετε το παράθυρο της τράπεζας${resource === 'success' ? '': ' και να επανεκκινήσετε τη διαδικασία'}.</p>
            </div>`,
        isBase64Encoded: true,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'text/html; charset=utf-8'
        }
      });
    })
    .catch(err => {
      console.log('err:', err);
      console.log('event:', event);
      context.succeed({
        statusCode: 200,
        body: 'Υπήρξε κάποιο σφάλμα.'
      });
    });
};
