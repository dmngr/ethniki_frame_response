"use strict";

const chai = require("chai");
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
const expect = chai.expect;

const get_card_info = require('../get_card_info');

// NOTE: Commented out to avoid 
describe('Get Card Info Module returns', function() {
  describe('card info for', function() {
    // it('EUROBANK MASTERCARD', function() {
    //   var bin = '516732*******123';
    //   return expect(get_card_info(bin)).to.eventually.deep.equal({
    //     cardType: {
    //       Name: 'MASTERCARD'
    //     },
    //     bank: 'EUROBANK ERGASIAS S.A.'
    //   });
    // });

    // it('EUROBANK VISA', function() {
    //   var bin = '479275*******123';
    //   return expect(get_card_info(bin)).to.eventually.deep.equal({
    //     cardType: {
    //       Name: 'VISA'
    //     },
    //     bank: 'EFG EUROBANK ERGASIAS, S.A.'
    //   });
    // });

    // it('ALPHA VISA', function() {
    //   var bin = '450903*******123';
    //   return expect(get_card_info(bin)).to.eventually.deep.equal({
    //     cardType: {
    //       Name: 'VISA'
    //     },
    //     bank: 'ALPHA BANK'
    //   });
    // });

    // it('ALPHA MASTERCARD', function() {
    //   var bin = '535018*******123';
    //   return expect(get_card_info(bin)).to.eventually.deep.equal({
    //     cardType: {
    //       Name: 'MASTERCARD'
    //     },
    //     bank: 'ALPHA BANK'
    //   });
    // });

  //   it('Revolut', function() {
  //     var bin = '539123*******123';
  //     return expect(get_card_info(bin)).to.eventually.deep.equal({
  //       cardType: {
  //         Name: 'MASTERCARD'
  //       },
  //       bank: 'PAYSAFE FINANCIAL SERVICES, LTD.'
  //     });
  //   });
  });

  describe('empty object for', function() {
    it('no card number', function() {
      return expect(get_card_info()).to.eventually.deep.equal({});
    });

    // it('Invalid card number', function() {
    //   var bin = '000000*******123';
    //   return expect(get_card_info(bin)).to.eventually.deep.equal({});
    // });

  });
});
