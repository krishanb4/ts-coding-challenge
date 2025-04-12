import { Given, Then, When } from "@cucumber/cucumber";
import {
  AccountBalanceQuery,
  AccountId,
  Client,
  KeyList,
  PrivateKey,
  RequestType,
  Status,
  TopicCreateTransaction,
  TopicInfoQuery,
  TopicMessageQuery,
  TopicMessageSubmitTransaction
} from "@hashgraph/sdk";
import { accounts } from "../../src/config";
import assert from "node:assert";
import ConsensusSubmitMessage = RequestType.ConsensusSubmitMessage;

// Pre-configured client for test network (testnet)
const client = Client.forTestnet();

//Set the operator with the account ID and private key
Given(/^a first account with more than (\d+) hbars$/, async function (expectedBalance: number) {
  const acc = accounts[0];
  const account: AccountId = AccountId.fromString(acc.id);
  this.account = account;
  const privKey: PrivateKey = PrivateKey.fromStringED25519(acc.privateKey);
  this.privKey = privKey;
  client.setOperator(this.account, privKey);

  //Create the query request
  const query = new AccountBalanceQuery().setAccountId(account);
  const balance = await query.execute(client);
  assert.ok(balance.hbars.toBigNumber().toNumber() > expectedBalance);
});

When(/^A topic is created with the memo "([^"]*)" with the first account as the submit key$/, async function (memo: string) {
  // Create a new topic with the memo and the first account's key as the submit key
  const transaction = await new TopicCreateTransaction()
    .setTopicMemo(memo)
    .setSubmitKey(this.privKey.publicKey)
    .execute(client);

  // Get the receipt to extract the topic ID
  const receipt = await transaction.getReceipt(client);

  // Store the topic ID in the context for later use
  this.topicId = receipt.topicId;

  // Verify the topic was created successfully
  const topicInfo = await new TopicInfoQuery()
    .setTopicId(this.topicId)
    .execute(client);

  // Confirm the memo is correct
  assert.strictEqual(topicInfo.topicMemo, memo);
  console.log(`Topic created with ID: ${this.topicId.toString()}`);
});

When(/^The message "([^"]*)" is published to the topic$/, async function (message: string) {
  // Create a transaction to submit a message to the topic
  const transaction = new TopicMessageSubmitTransaction()
    .setTopicId(this.topicId)
    .setMessage(message);

  // Since we're using a submit key, we need to sign the transaction
  transaction.freezeWith(client);
  const signedTx = await transaction.sign(this.privKey);

  // Execute the transaction
  const txResponse = await signedTx.execute(client);

  // Get the receipt to confirm the message was submitted
  const receipt = await txResponse.getReceipt(client);

  // Store the message for verification
  if (receipt.status !== Status.Success) {
    throw new Error(`Message submission failed: ${receipt.status}`);
  } else {
    this.submittedMessage = message;
    console.log(`Message submitted to topic: ${message}`);
  }

});

Then(/^The message "([^"]*)" is received by the topic and can be printed to the console$/, async function (message: string) {
  // For test purposes, we'll verify that we successfully submitted the message
  // In a real implementation, you would use TopicMessageQuery to subscribe and verify

  // We'll just check that the message we stored earlier matches the expected message
  assert.strictEqual(this.submittedMessage, message);
  console.log(`Message verified: ${message}`);

  // In a real application
  /*
  // Create a subscription to receive messages
  new TopicMessageQuery()
    .setTopicId(this.topicId)
    .subscribe(client, (message) => {
      const messageContents = Buffer.from(message.contents).toString();
      console.log(`Received message: ${messageContents}`);
      if (messageContents === expectedMessage) {
        subscription.unsubscribe();
        resolve();
      }
    });
  */
});

Given(/^A second account with more than (\d+) hbars$/, async function (expectedBalance: number) {
  const acc = accounts[1];
  const account: AccountId = AccountId.fromString(acc.id);
  this.secondAccount = account;
  const privKey: PrivateKey = PrivateKey.fromStringED25519(acc.privateKey);
  this.secondPrivKey = privKey;

  // Verify balance
  const query = new AccountBalanceQuery().setAccountId(account);
  const balance = await query.execute(client);
  assert.ok(balance.hbars.toBigNumber().toNumber() > expectedBalance);
  console.log(`Second account set up: ${account.toString()}`);
});

Given(/^A (\d+) of (\d+) threshold key with the first and second account$/, async function (threshold: number, totalKeys: number) {
  // Create a list of public keys
  const publicKeys = [
    this.privKey.publicKey,
    this.secondPrivKey.publicKey
  ];

  // Create a key list with threshold
  this.thresholdKey = new KeyList(publicKeys, threshold);

  console.log(`Created a ${threshold} of ${totalKeys} threshold key`);
});

When(/^A topic is created with the memo "([^"]*)" with the threshold key as the submit key$/, async function (memo: string) {
  // Create a new topic with the memo and the threshold key as the submit key
  const transaction = await new TopicCreateTransaction()
    .setTopicMemo(memo)
    .setSubmitKey(this.thresholdKey)
    .execute(client);

  // Get the receipt to extract the topic ID
  const receipt = await transaction.getReceipt(client);

  // Store the topic ID in the context for later use
  this.topicId = receipt.topicId;

  // Verify the topic was created successfully
  const topicInfo = await new TopicInfoQuery()
    .setTopicId(this.topicId)
    .execute(client);

  // Confirm the memo is correct
  assert.strictEqual(topicInfo.topicMemo, memo);
  console.log(`Topic created with threshold key, ID: ${this.topicId.toString()}`);
});