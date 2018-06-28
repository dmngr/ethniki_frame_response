"use strict";
var Promise = require('bluebird');

const request = Promise.promisify(require('request'), {
  multiArgs: true
});

const fs = require('fs');

module.exports = function(card_number) {
  // NOTE: Cred is in Dropbox cred folder, named bin_codes_cred.json
  return Promise.try(() => {
      if (!card_number || card_number.length < 6) return Promise.reject('Invalid card number: ', card_number);
      else {
        let api_key = JSON.parse(fs.readFileSync('cred.json', 'utf-8')).bin_api_key;
        return request(`https://api.bincodes.com/bin/?format=json&api_key=${api_key}&bin=${card_number.substr(0, 6)}`)
          .spread((res, body) => {
            body = JSON.parse(body);
            console.log('get card_info body:', body);

            if (!body.valid || body.valid === 'false') return Promise.reject(body);
            else {
              return Promise.resolve({
                cardType: {
                  Name: body.card
                },
                bank: body.bank
              });
            }
          });
      }
    })
    .then(res => {
      console.log('get_card_info res:', res);
      return Promise.resolve(res);
    })
    .catch(err => {
      console.log('err:', err);
      return Promise.resolve({});
    });
};
