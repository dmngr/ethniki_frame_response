"use strict";

var Promise = require('bluebird');

const AWS = require('aws-sdk');
const client = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();

const qs = require('query-string');
const _ = require('lodash');
const moment = require('moment');

const util = require('@deliverymanager/util');
const s3_getObject = Promise.promisify(util.s3_getObject);
const lambda_invoke = Promise.promisify(util.lambda_invoke);
const prune_null = util.prune_null;
const prune_empty = util.prune_empty;

const get_card_info = require('./get_card_info');

exports.handler = function(event, context, callback) {
  let resource;
  let group;
  let store_id;
  let order_id;
  let savecard;
  let mobile;
  let cred;
  let amount;

  Promise.try(() => {
      console.log('event:', JSON.stringify(event, null, 2));
      resource = event.resource.substr(event.resource.lastIndexOf('/') + 1);
      console.log('resource:', resource);
      let body = event.queryStringParameters;
      console.log('body:', body);
      // let store_id = body.orderid.slice(0, 6);
      // let order_id = body.orderid.slice(16);

      if (resource === 'back' || resource === 'expiry') return Promise.resolve();
      else if (body.__testing) {
        console.log('Simulating failed url call from front end');
        return Promise.resolve();

      } else {
        store_id = body.merchantreference.slice(0, 6);
        order_id = body.merchantreference.slice(6, -10);
        group = body.group;
        mobile = body.mobile;
        amount = body.Amount;

        if (order_id.indexOf('scard') !== -1) {
          savecard = true;
          order_id = order_id.replace('scard', '');
        }

        console.log('store_id:', store_id);
        console.log('order_id:', order_id);
        console.log('savecard:', savecard);

        return Promise.join(
          // get cred
          s3_getObject({
            Bucket: 'bankscred',
            Key: `${group}/${store_id}/ethniki/cred.json`
          }, {}),
          // get storeAccount
          s3_getObject({
            Bucket: 'allgroups',
            Key: `${group}/${store_id}/storeAccount.json`
          }, {}),
          (s3_cred, store) => {
            cred = JSON.parse(s3_cred);
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
      console.log('body:', body);
      if (!body) return Promise.resolve();
      else if (body.status === '1') {
        resource = 'success';

        return Promise.join(
          // update order if it exists
          order_id ? client.update({
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
          }).promise() : Promise.resolve(),
          // send message for refund to worker
          !order_id && savecard ? sqs.sendMessage({
            QueueUrl: 'https://sqs.eu-west-1.amazonaws.com/787324535455/worker',
            MessageBody: JSON.stringify({
              type: 'refund',
              refund: {
                paymentGateway: 'ethniki',
                store_id: store_id,
                client: cred.client,
                password: cred.password,
                RequestType: 'refund',
                Amount: amount,
                TransactionId: body.TransactionId,
                MerchantReference: body.MerchantReference
              }
            }),
            DelaySeconds: 0
          }).promise() : Promise.resolve(),
          // save card
          savecard ? Promise.join(
            // get customer cards
            client.get({
              TableName: 'customers',
              Key: {
                group: group,
                mobile: mobile
              },
              AttributesToGet: [
                'mobile',
                'cards'
              ]
            }).promise(),
            get_card_info(body.pan),
            (customer, card_info) => {
              customer = prune_null(customer.Item);
              console.log('Saving card');
              console.log('customer:', customer);

              let creditCard = {
                'Number': body.pan,
                ExpirationDate: moment().year(parseInt(body.expirydate.slice(2), 10) + 2000).month(parseInt(body.expirydate.slice(0, 2), 10) - 1).endOf('month').format('YYYY-MM-DDT00:00:00')
              };

              if (!card_info.bank && body.issuer) card_info.bank = body.issuer;
              if (!card_info.cardType && body.card_scheme) card_info.cardType = {
                Name: body.card_scheme
              };

              if (_.isEmpty(customer.cards)) customer.cards = [];

              let index = _.findIndex(customer.cards, {
                number: creditCard.Number
              });

              if (index === -1) {
                customer.cards.push({
                  paymentGatewayLabel: 'Εθνική Τράπεζα',
                  paymentGateway: "ethniki",
                  number: creditCard.Number,
                  expiry: creditCard.ExpirationDate,
                  timestamp: Date.now(),
                  bank: card_info.bank,
                  cardType: card_info.cardType,
                  stores: [{
                    store_id: store_id,
                    timestamp: Date.now(),
                    transaction_id: body.TransactionId,
                    token: body.TransactionId,
                    publicKey: body.mid
                  }]
                });

              } else {
                let storeIndex = _.findIndex(customer.cards[index].stores, {
                  store_id: store_id
                });

                if (storeIndex !== -1) {
                  customer.cards[index].stores[storeIndex] = {
                    store_id: store_id,
                    timestamp: Date.now(),
                    transaction_id: body.TransactionId,
                    token: body.TransactionId,
                    publicKey: body.mid
                  };

                  customer.cards[index] = {
                    paymentGatewayLabel: 'Εθνική Τράπεζα',
                    paymentGateway: "ethniki",
                    number: creditCard.Number,
                    expiry: creditCard.ExpirationDate,
                    timestamp: Date.now(),
                    bank: card_info.bank,
                    cardType: card_info.cardType,
                    stores: customer.cards[index].stores
                  };

                } else {
                  customer.cards[index].stores.push({
                    store_id: store_id,
                    timestamp: Date.now(),
                    transaction_id: body.TransactionId,
                    token: body.TransactionId,
                    publicKey: body.mid
                  });

                  customer.cards[index] = {
                    paymentGatewayLabel: 'Εθνική Τράπεζα',
                    paymentGateway: "ethniki",
                    number: creditCard.Number,
                    expiry: creditCard.ExpirationDate,
                    timestamp: Date.now(),
                    bank: card_info.bank,
                    cardType: card_info.cardType,
                    stores: customer.cards[index].stores
                  };
                }
              }

              // update customer cards
              return client.update({
                TableName: 'customers',
                Key: {
                  group: group,
                  mobile: customer.mobile
                },
                UpdateExpression: 'set #cards = :cards',
                ExpressionAttributeNames: {
                  '#cards': 'cards'
                },
                ExpressionAttributeValues: {
                  ':cards': prune_empty(customer.cards)
                }
              }).promise();
            }
          ) : Promise.resolve(),
          () => Promise.resolve()
        );

      } else return Promise.reject(body);
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
      else if (resource === 'back') {
        h3 += 'ακυρώθηκε επιτυχώς!';
        resource = 'backlink';

      } else h3 += 'απέτυχε!';

      context.succeed({
        statusCode: 200,
        // TODO: resource
        body: `<link rel="stylesheet" href="https://${event.store ? event.store.paymentGateways.ethniki.url.replace('frame.html', '') : 'demo.deliverymanager.gr/ethniki/'}style.css">
        <link rel="stylesheet" href="https://${event.store ? event.store.paymentGateways.ethniki.url.replace('frame.html', '') : 'demo.deliverymanager.gr/ethniki/'}fonts/icomoon.woff?leqvcx">
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
