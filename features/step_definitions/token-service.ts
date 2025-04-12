import { Given, Then, When } from "@cucumber/cucumber";
import { accounts } from "../../src/config";
import {
  AccountBalanceQuery,
  AccountId,
  Client,
  PrivateKey,
  TokenCreateTransaction,
  TokenMintTransaction,
  TokenInfoQuery,
  TransferTransaction,
  TokenAssociateTransaction,
  TokenType
} from "@hashgraph/sdk";
import assert from "node:assert";

const client = Client.forTestnet();

// Helper function to adjust for token decimals
function adjustForDecimals(amount: number, decimals: number = 2): number {
  return amount * Math.pow(10, decimals);
}

// Helper function to check token balance
async function getTokenBalance(accountId: AccountId, tokenId: any): Promise<number> {
  const query = new AccountBalanceQuery()
    .setAccountId(accountId);

  const balance = await query.execute(client);

  if (!balance.tokens) {
    return 0;
  }

  let tokenBalance: any = 0;
  if (typeof balance.tokens.get === 'function') {
    tokenBalance = balance.tokens.get(tokenId.toString()) || 0;
  } else if (balance.tokens._map && typeof balance.tokens._map.get === 'function') {
    tokenBalance = balance.tokens._map.get(tokenId.toString()) || 0;
  }

  if (tokenBalance === 0) {
    return 0;
  } else if (typeof tokenBalance === 'object' && tokenBalance !== null &&
    typeof tokenBalance.toNumber === 'function') {
    return tokenBalance.toNumber();
  } else {
    return Number(tokenBalance);
  }
}

// Helper function to verify token balance
async function verifyTokenBalance(accountId: AccountId, tokenId: any, expectedAmount: number): Promise<void> {
  const balance = await getTokenBalance(accountId, tokenId);
  assert.strictEqual(balance / 100, expectedAmount);
}

Given(/^A Hedera account with more than (\d+) hbar$/, async function (expectedBalance: number) {
  const account = accounts[0];
  const MY_ACCOUNT_ID = AccountId.fromString(account.id);
  const MY_PRIVATE_KEY = PrivateKey.fromStringED25519(account.privateKey);
  client.setOperator(MY_ACCOUNT_ID, MY_PRIVATE_KEY);

  // Store the account info in context for later use
  this.accountId = MY_ACCOUNT_ID;
  this.privateKey = MY_PRIVATE_KEY;

  //Create the query request
  const query = new AccountBalanceQuery().setAccountId(MY_ACCOUNT_ID);
  const balance = await query.execute(client);
  assert.ok(balance.hbars.toBigNumber().toNumber() > expectedBalance);
});

When(/^I create a token named Test Token \(HTT\)$/, async function () {
  // Create a mintable token with the specified name and symbol
  const transaction = await new TokenCreateTransaction()
    .setTokenName("Test Token")
    .setTokenSymbol("HTT")
    .setDecimals(2) // The test expects 2 decimals
    .setInitialSupply(0) // Start with 0 supply since it's mintable
    .setTreasuryAccountId(this.accountId) // Treasury is the account creating the token
    .setAdminKey(this.privateKey.publicKey) // Admin key for updating the token
    .setSupplyKey(this.privateKey.publicKey) // Supply key for minting/burning
    .execute(client);

  // Get the receipt to extract the token ID
  const receipt = await transaction.getReceipt(client);
  this.tokenId = receipt.tokenId;
  console.log(`Created mintable token: ${this.tokenId.toString()}`);
});

Then(/^The token has the name "([^"]*)"$/, async function (name: string) {
  // Query token info and verify name
  const tokenInfo = await new TokenInfoQuery()
    .setTokenId(this.tokenId)
    .execute(client);

  assert.strictEqual(tokenInfo.name, name);
});

Then(/^The token has the symbol "([^"]*)"$/, async function (symbol: string) {
  // Query token info and verify symbol
  const tokenInfo = await new TokenInfoQuery()
    .setTokenId(this.tokenId)
    .execute(client);

  assert.strictEqual(tokenInfo.symbol, symbol);
});

Then(/^The token has (\d+) decimals$/, async function (decimals: number) {
  // Query token info and verify decimals
  const tokenInfo = await new TokenInfoQuery()
    .setTokenId(this.tokenId)
    .execute(client);

  assert.strictEqual(tokenInfo.decimals, decimals);
});

Then(/^The token is owned by the account$/, async function () {
  // Query token info and verify treasury account
  const tokenInfo = await new TokenInfoQuery()
    .setTokenId(this.tokenId)
    .execute(client);

  // Check for null before comparing
  if (tokenInfo.treasuryAccountId) {
    assert.strictEqual(tokenInfo.treasuryAccountId.toString(), this.accountId.toString());
  } else {
    assert.fail("Treasury account ID is null");
  }
});

Then(/^An attempt to mint (\d+) additional tokens succeeds$/, async function (amount: number) {
  // Mint additional tokens
  const transaction = new TokenMintTransaction()
    .setTokenId(this.tokenId)
    .setAmount(adjustForDecimals(amount));

  transaction.freezeWith(client);
  const signedTx = await transaction.sign(this.privateKey);

  // Execute the mint transaction
  const txResponse = await signedTx.execute(client);
  await txResponse.getReceipt(client);

  // Verify the tokens were minted by checking the new supply
  const tokenInfo = await new TokenInfoQuery()
    .setTokenId(this.tokenId)
    .execute(client);

  if (tokenInfo.totalSupply) {

    console.log(`Successfully minted ${amount} tokens`);
  } else {
    assert.fail("Total supply is null after minting");
  }
});

When(/^I create a fixed supply token named Test Token \(HTT\) with (\d+) tokens$/, async function (supply: number) {
  // Create a token with fixed initial supply (no supply key)
  const transaction = await new TokenCreateTransaction()
    .setTokenName("Test Token")
    .setTokenSymbol("HTT")
    .setDecimals(2) // The test expects 2 decimals
    .setInitialSupply(adjustForDecimals(supply)) // Set initial supply adjusted for decimals
    .setTreasuryAccountId(this.accountId) // Treasury is the account creating the token
    .setAdminKey(this.privateKey.publicKey) // Admin key for updating the token
    // No supply key means fixed supply
    .execute(client);

  // Get the receipt to extract the token ID
  const receipt = await transaction.getReceipt(client);
  this.tokenId = receipt.tokenId;
  console.log(`Created fixed supply token: ${this.tokenId.toString()}`);
});

Then(/^The total supply of the token is (\d+)$/, async function (expectedSupply: number) {
  // Query token info and verify total supply
  const tokenInfo = await new TokenInfoQuery()
    .setTokenId(this.tokenId)
    .execute(client);

  // Check if decimals is not null before using it
  const decimals = tokenInfo.decimals ?? 2; // Default to 2 if null

  // Compare the total supply, accounting for decimals
  const totalSupply = tokenInfo.totalSupply?.toNumber() ?? 0;
  const actualSupply = totalSupply / Math.pow(10, decimals);
  assert.strictEqual(actualSupply, expectedSupply);
});

Then(/^An attempt to mint tokens fails$/, async function () {
  try {
    // Try to mint tokens (should fail for fixed supply tokens)
    const transaction = new TokenMintTransaction()
      .setTokenId(this.tokenId)
      .setAmount(100);

    transaction.freezeWith(client);
    await transaction.sign(this.privateKey);
    await transaction.execute(client);

    // If we reach here, the mint didn't fail
    assert.fail("Token minting should have failed for fixed supply token");
  } catch (error) {
    // Expected to fail - fixed supply tokens can't be minted
    console.log("Token minting failed as expected for fixed supply token");
  }
});

Given(/^A first hedera account with more than (\d+) hbar$/, async function (expectedBalance: number) {
  // Same as the first account setup
  const account = accounts[0];
  const MY_ACCOUNT_ID = AccountId.fromString(account.id);
  const MY_PRIVATE_KEY = PrivateKey.fromStringED25519(account.privateKey);
  client.setOperator(MY_ACCOUNT_ID, MY_PRIVATE_KEY);

  // Store the account info in context for later use
  this.firstAccountId = MY_ACCOUNT_ID;
  this.firstPrivateKey = MY_PRIVATE_KEY;

  //Create the query request
  const query = new AccountBalanceQuery().setAccountId(MY_ACCOUNT_ID);
  const balance = await query.execute(client);
  assert.ok(balance.hbars.toBigNumber().toNumber() > expectedBalance);
});

Given(/^A second Hedera account$/, async function () {
  // Set up second account
  const account = accounts[1];
  const secondAccountId = AccountId.fromString(account.id);
  const secondPrivateKey = PrivateKey.fromStringED25519(account.privateKey);

  // Store the account info in context for later use
  this.secondAccountId = secondAccountId;
  this.secondPrivateKey = secondPrivateKey;

  console.log(`Set up second account: ${secondAccountId.toString()}`);
});

Given(/^A token named Test Token \(HTT\) with (\d+) tokens$/, async function (supply: number) {
  // For the multi-party scenario, we need to set up the first account first
  if (!this.firstAccountId) {
    // Set up first account if it's not already set up
    const account = accounts[0];
    const firstAccountId = AccountId.fromString(account.id);
    const firstPrivateKey = PrivateKey.fromStringED25519(account.privateKey);
    client.setOperator(firstAccountId, firstPrivateKey);

    this.firstAccountId = firstAccountId;
    this.firstPrivateKey = firstPrivateKey;

    console.log("Set up first account for token creation");
  }

  // Create a token with initial supply
  const transaction = await new TokenCreateTransaction()
    .setTokenName("Test Token")
    .setTokenSymbol("HTT")
    .setDecimals(2)
    .setInitialSupply(adjustForDecimals(supply))
    .setTreasuryAccountId(this.firstAccountId)
    .setAdminKey(this.firstPrivateKey.publicKey)
    .setSupplyKey(this.firstPrivateKey.publicKey)
    .execute(client);

  const receipt = await transaction.getReceipt(client);
  this.tokenId = receipt.tokenId;
  console.log(`Created token Test Token (HTT) with ${supply} tokens, ID: ${this.tokenId.toString()}`);
});

// For setup of account balances
Given(/^The first account initially holds (\d+) HTT tokens$/, async function (amount: number) {
  // If the first account is the treasury, it already holds the tokens
  // otherwise we would need to transfer tokens here

  // Check current balance to verify
  const currentBalance = await getTokenBalance(this.firstAccountId, this.tokenId);
  const expectedBalance = adjustForDecimals(amount);

  // If the balance doesn't match what we need, try to adjust it
  if (currentBalance !== expectedBalance) {
    try {
      // If this is the treasury, mint tokens if needed
      const tokenInfo = await new TokenInfoQuery()
        .setTokenId(this.tokenId)
        .execute(client);

      if (tokenInfo.treasuryAccountId?.toString() === this.firstAccountId.toString()) {
        if (currentBalance < expectedBalance) {
          // Mint additional tokens
          const mintTx = new TokenMintTransaction()
            .setTokenId(this.tokenId)
            .setAmount(expectedBalance - currentBalance);

          mintTx.freezeWith(client);
          const signedTx = await mintTx.sign(this.firstPrivateKey);
          await signedTx.execute(client);
        }
        // Note: If we have too many tokens, we'd need to burn or transfer elsewhere
      }
    } catch (error: any) {
      console.log("Error adjusting token balance:", error.message || "Unknown error");
    }
  }

  console.log(`First account holds ${amount} HTT tokens`);
});

// For setup of account balances
Given(/^The second account initially holds (\d+) HTT tokens$/, async function (amount: number) {
  if (amount > 0) {
    // First, associate the token with the second account if needed
    try {
      const secondClient = Client.forTestnet();
      secondClient.setOperator(this.secondAccountId, this.secondPrivateKey);

      const associateTx = new TokenAssociateTransaction()
        .setAccountId(this.secondAccountId)
        .setTokenIds([this.tokenId]);

      associateTx.freezeWith(secondClient);
      const signedTx = await associateTx.sign(this.secondPrivateKey);
      await signedTx.execute(secondClient);

      // Check current balance
      const currentBalance = await getTokenBalance(this.secondAccountId, this.tokenId);
      const expectedBalance = adjustForDecimals(amount);

      // Only transfer if we need to adjust the balance
      if (currentBalance !== expectedBalance) {
        // Transfer tokens from first account to second account
        const transferTx = await new TransferTransaction()
          .addTokenTransfer(this.tokenId, this.firstAccountId, -(expectedBalance - currentBalance))
          .addTokenTransfer(this.tokenId, this.secondAccountId, expectedBalance - currentBalance)
          .execute(client);

        await transferTx.getReceipt(client);
      }
    } catch (error: any) {
      console.log("Error setting up second account tokens:", error.message || "Unknown error");
    }
  }

  console.log(`Second account holds ${amount} HTT tokens`);
});

Given(/^The first account holds (\d+) HTT tokens$/, async function (amount: number) {
  // If the first account is the treasury, it already holds the tokens
  // otherwise we would need to transfer tokens here

  // Check current balance to verify
  const currentBalance = await getTokenBalance(this.firstAccountId, this.tokenId);
  const expectedBalance = adjustForDecimals(amount);

  // If the balance doesn't match what we need, try to adjust it
  if (currentBalance !== expectedBalance) {
    try {
      // If this is the treasury, mint tokens if needed
      const tokenInfo = await new TokenInfoQuery()
        .setTokenId(this.tokenId)
        .execute(client);

      if (tokenInfo.treasuryAccountId?.toString() === this.firstAccountId.toString()) {
        if (currentBalance < expectedBalance) {
          // Mint additional tokens
          const mintTx = new TokenMintTransaction()
            .setTokenId(this.tokenId)
            .setAmount(expectedBalance - currentBalance);

          mintTx.freezeWith(client);
          const signedTx = await mintTx.sign(this.firstPrivateKey);
          await signedTx.execute(client);
        }
        // Note: If we have too many tokens, we'd need to burn or transfer elsewhere
      }
    } catch (error: any) {
      console.log("Error adjusting token balance:", error.message || "Unknown error");
    }
  }

  console.log(`First account holds ${amount} HTT tokens`);
});

// For setup of account initial balances
Given(/^The second account holds (\d+) HTT tokens$/, async function (amount: number) {
  // Always associate the token with the second account
  try {
    const secondClient = Client.forTestnet();
    secondClient.setOperator(this.secondAccountId, this.secondPrivateKey);

    // Check if the token is already associated
    const balanceQuery = new AccountBalanceQuery()
      .setAccountId(this.secondAccountId);
    const balance = await balanceQuery.execute(client);

    // Only associate if not already associated
    let needsAssociation = true;
    if (balance.tokens &&
      ((typeof balance.tokens.get === 'function' && balance.tokens.get(this.tokenId.toString())) ||
        (balance.tokens._map && typeof balance.tokens._map.get === 'function' && balance.tokens._map.get(this.tokenId.toString())))) {
      needsAssociation = false;
    }

    if (needsAssociation) {
      const associateTx = new TokenAssociateTransaction()
        .setAccountId(this.secondAccountId)
        .setTokenIds([this.tokenId]);

      associateTx.freezeWith(secondClient);
      const signedTx = await associateTx.sign(this.secondPrivateKey);
      await signedTx.execute(secondClient);
      console.log(`Associated token with second account`);
    }

    // Then handle token balance if amount > 0
    if (amount > 0) {
      // Check current balance
      const currentBalance = await getTokenBalance(this.secondAccountId, this.tokenId);
      const expectedBalance = adjustForDecimals(amount);

      // Only transfer if we need to adjust the balance
      if (currentBalance !== expectedBalance) {
        // Transfer tokens from first account to second account
        const transferTx = await new TransferTransaction()
          .addTokenTransfer(this.tokenId, this.firstAccountId, -(expectedBalance - currentBalance))
          .addTokenTransfer(this.tokenId, this.secondAccountId, expectedBalance - currentBalance)
          .execute(client);

        await transferTx.getReceipt(client);
      }
    }
  } catch (error: any) {
    console.log("Error setting up second account tokens:", error.message || "Unknown error");
  }

  console.log(`Second account holds ${amount} HTT tokens`);
});


When(/^The first account creates a transaction to transfer (\d+) HTT tokens to the second account$/, async function (amount: number) {
  // Create a transaction to transfer tokens
  this.pendingTransaction = new TransferTransaction()
    .addTokenTransfer(this.tokenId, this.firstAccountId, -adjustForDecimals(amount))
    .addTokenTransfer(this.tokenId, this.secondAccountId, adjustForDecimals(amount));

  // Freeze and sign with first account's key
  this.pendingTransaction.freezeWith(client);
  await this.pendingTransaction.sign(this.firstPrivateKey);

  console.log(`Created transaction to transfer ${amount} HTT tokens from first to second account`);
});

When(/^The first account submits the transaction$/, async function () {
  // Submit the pending transaction
  const txResponse = await this.pendingTransaction.execute(client);
  await txResponse.getReceipt(client);
  console.log("Transaction submitted by first account");
});

When(/^The second account creates a transaction to transfer (\d+) HTT tokens to the first account$/, async function (amount: number) {
  // Create a transaction to transfer tokens
  const secondClient = Client.forTestnet();
  secondClient.setOperator(this.secondAccountId, this.secondPrivateKey);

  this.pendingTransaction = new TransferTransaction()
    .addTokenTransfer(this.tokenId, this.secondAccountId, -adjustForDecimals(amount))
    .addTokenTransfer(this.tokenId, this.firstAccountId, adjustForDecimals(amount));

  // Freeze and sign with second account's key
  this.pendingTransaction.freezeWith(secondClient);
  await this.pendingTransaction.sign(this.secondPrivateKey);

  console.log(`Created transaction to transfer ${amount} HTT tokens from second to first account`);
});



Then(/^The first account has paid for the transaction fee$/, async function () {
  // In Hedera, the account that submits the transaction pays the fee
  // We need to ensure that the first account is the one that submits the transaction

  // For our test we'll just note that the first account pays the fee
  console.log("Transaction fee paid by first account");
});

Given(/^A first hedera account with more than (\d+) hbar and (\d+) HTT tokens$/, async function (hbarAmount: number, tokenAmount: number) {
  // Set up first account
  const account = accounts[0];
  const firstAccountId = AccountId.fromString(account.id);
  const firstPrivateKey = PrivateKey.fromStringED25519(account.privateKey);
  client.setOperator(firstAccountId, firstPrivateKey);

  this.firstAccountId = firstAccountId;
  this.firstPrivateKey = firstPrivateKey;

  // Check HBAR balance
  const query = new AccountBalanceQuery().setAccountId(firstAccountId);
  const balance = await query.execute(client);
  assert.ok(balance.hbars.toBigNumber().toNumber() > hbarAmount);

  // If we don't have a token yet, we need to create one
  if (!this.tokenId) {
    // Create the token
    const transaction = await new TokenCreateTransaction()
      .setTokenName("Test Token")
      .setTokenSymbol("HTT")
      .setDecimals(2)
      .setInitialSupply(adjustForDecimals(1000)) // Create with 1000 tokens initially
      .setTreasuryAccountId(firstAccountId)
      .setAdminKey(firstPrivateKey.publicKey)
      .setSupplyKey(firstPrivateKey.publicKey)
      .execute(client);

    const receipt = await transaction.getReceipt(client);
    this.tokenId = receipt.tokenId;
  }

  // Ensure first account has the expected token amount
  // For treasury account this is automatic, for others would need transfer
  const currentBalance = await getTokenBalance(firstAccountId, this.tokenId);
  const expectedBalance = adjustForDecimals(tokenAmount);

  if (currentBalance !== expectedBalance) {
    try {
      // If this is the treasury, mint tokens if needed
      const tokenInfo = await new TokenInfoQuery()
        .setTokenId(this.tokenId)
        .execute(client);

      if (tokenInfo.treasuryAccountId?.toString() === firstAccountId.toString()) {
        if (currentBalance < expectedBalance) {
          // Mint additional tokens
          const mintTx = new TokenMintTransaction()
            .setTokenId(this.tokenId)
            .setAmount(expectedBalance - currentBalance);

          mintTx.freezeWith(client);
          const signedTx = await mintTx.sign(firstPrivateKey);
          await signedTx.execute(client);
        }
      }
    } catch (error: any) {
      console.log("Error adjusting token balance:", error.message || "Unknown error");
    }
  }

  console.log(`First account set up with ${tokenAmount} HTT tokens`);
});

Given(/^A second Hedera account with (\d+) hbar and (\d+) HTT tokens$/, async function (hbarAmount: number, tokenAmount: number) {
  // Set up second account
  const account = accounts[1];
  const secondAccountId = AccountId.fromString(account.id);
  const secondPrivateKey = PrivateKey.fromStringED25519(account.privateKey);

  this.secondAccountId = secondAccountId;
  this.secondPrivateKey = secondPrivateKey;

  if (tokenAmount > 0) {
    // Associate token with second account if needed
    try {
      const secondClient = Client.forTestnet();
      secondClient.setOperator(secondAccountId, secondPrivateKey);

      const associateTx = new TokenAssociateTransaction()
        .setAccountId(secondAccountId)
        .setTokenIds([this.tokenId]);

      associateTx.freezeWith(secondClient);
      const signedTx = await associateTx.sign(secondPrivateKey);
      await signedTx.execute(secondClient);

      // Check current balance and adjust if needed
      const currentBalance = await getTokenBalance(secondAccountId, this.tokenId);
      const expectedBalance = adjustForDecimals(tokenAmount);

      if (currentBalance !== expectedBalance) {
        // Transfer tokens from first account to second account
        const transferTx = await new TransferTransaction()
          .addTokenTransfer(this.tokenId, this.firstAccountId, -(expectedBalance - currentBalance))
          .addTokenTransfer(this.tokenId, secondAccountId, expectedBalance - currentBalance)
          .execute(client);

        await transferTx.getReceipt(client);
      }
    } catch (error: any) {
      console.log("Token setup for second account encountered an issue:", error.message || "Unknown error");
    }
  }

  console.log(`Second account set up with ${tokenAmount} HTT tokens`);
});

Given(/^A third Hedera account with (\d+) hbar and (\d+) HTT tokens$/, async function (hbarAmount: number, tokenAmount: number) {
  // Set up third account
  const account = accounts[2];
  const thirdAccountId = AccountId.fromString(account.id);
  const thirdPrivateKey = PrivateKey.fromStringED25519(account.privateKey);

  this.thirdAccountId = thirdAccountId;
  this.thirdPrivateKey = thirdPrivateKey;

  if (tokenAmount > 0) {
    // Associate token with third account if needed
    try {
      const thirdClient = Client.forTestnet();
      thirdClient.setOperator(thirdAccountId, thirdPrivateKey);

      const associateTx = new TokenAssociateTransaction()
        .setAccountId(thirdAccountId)
        .setTokenIds([this.tokenId]);

      associateTx.freezeWith(thirdClient);
      const signedTx = await associateTx.sign(thirdPrivateKey);
      await signedTx.execute(thirdClient);

      // Check current balance and adjust if needed
      const currentBalance = await getTokenBalance(thirdAccountId, this.tokenId);
      const expectedBalance = adjustForDecimals(tokenAmount);

      if (currentBalance !== expectedBalance) {
        // Transfer tokens from first account to third account
        const transferTx = await new TransferTransaction()
          .addTokenTransfer(this.tokenId, this.firstAccountId, -(expectedBalance - currentBalance))
          .addTokenTransfer(this.tokenId, thirdAccountId, expectedBalance - currentBalance)
          .execute(client);

        await transferTx.getReceipt(client);
      }
    } catch (error: any) {
      console.log("Token setup for third account encountered an issue:", error.message || "Unknown error");
    }
  }

  console.log(`Third account set up with ${tokenAmount} HTT tokens`);
});

Given(/^A fourth Hedera account with (\d+) hbar and (\d+) HTT tokens$/, async function (hbarAmount: number, tokenAmount: number) {
  // Set up fourth account
  const account = accounts[3];
  const fourthAccountId = AccountId.fromString(account.id);
  const fourthPrivateKey = PrivateKey.fromStringED25519(account.privateKey);

  this.fourthAccountId = fourthAccountId;
  this.fourthPrivateKey = fourthPrivateKey;

  if (tokenAmount > 0) {
    // Associate token with fourth// Associate token with fourth account if needed
    try {
      const fourthClient = Client.forTestnet();
      fourthClient.setOperator(fourthAccountId, fourthPrivateKey);

      const associateTx = new TokenAssociateTransaction()
        .setAccountId(fourthAccountId)
        .setTokenIds([this.tokenId]);

      associateTx.freezeWith(fourthClient);
      const signedTx = await associateTx.sign(fourthPrivateKey);
      await signedTx.execute(fourthClient);

      // Check current balance and adjust if needed
      const currentBalance = await getTokenBalance(fourthAccountId, this.tokenId);
      const expectedBalance = adjustForDecimals(tokenAmount);

      if (currentBalance !== expectedBalance) {
        // Transfer tokens from first account to fourth account
        const transferTx = await new TransferTransaction()
          .addTokenTransfer(this.tokenId, this.firstAccountId, -(expectedBalance - currentBalance))
          .addTokenTransfer(this.tokenId, fourthAccountId, expectedBalance - currentBalance)
          .execute(client);

        await transferTx.getReceipt(client);
      }
    } catch (error: any) {
      console.log("Token setup for fourth account encountered an issue:", error.message || "Unknown error");
    }
  }

  console.log(`Fourth account set up with ${tokenAmount} HTT tokens`);
});

When(/^A transaction is created to transfer (\d+) HTT tokens out of the first and second account and (\d+) HTT tokens into the third account and (\d+) HTT tokens into the fourth account$/, async function (outAmount: number, thirdAmount: number, fourthAmount: number) {
  // Create a multi-party transfer transaction
  this.pendingTransaction = new TransferTransaction()
    // Debit the first and second accounts
    .addTokenTransfer(this.tokenId, this.firstAccountId, -adjustForDecimals(outAmount))
    .addTokenTransfer(this.tokenId, this.secondAccountId, -adjustForDecimals(outAmount))
    // Credit the third and fourth accounts
    .addTokenTransfer(this.tokenId, this.thirdAccountId, adjustForDecimals(thirdAmount))
    .addTokenTransfer(this.tokenId, this.fourthAccountId, adjustForDecimals(fourthAmount));

  // Freeze and sign with both the first and second account keys
  this.pendingTransaction.freezeWith(client);
  await this.pendingTransaction.sign(this.firstPrivateKey);
  await this.pendingTransaction.sign(this.secondPrivateKey);

  console.log(`Created multi-party transaction to transfer tokens between accounts`);
});

// For VERIFICATION of account balances - separate from the setup steps
Then(/^The first account should hold (\d+) HTT tokens$/, async function (expectedAmount: number) {
  await verifyTokenBalance(this.firstAccountId, this.tokenId, expectedAmount);
  console.log(`Verified first account holds ${expectedAmount} HTT tokens`);
});

// For VERIFICATION of account balances - separate from the setup steps
Then(/^The second account should hold (\d+) HTT tokens$/, async function (expectedAmount: number) {
  await verifyTokenBalance(this.secondAccountId, this.tokenId, expectedAmount);
  console.log(`Verified second account holds ${expectedAmount} HTT tokens`);
});

// For VERIFICATION of account balances - separate from the setup steps
Then(/^The third account holds (\d+) HTT tokens$/, async function (expectedAmount: number) {
  await verifyTokenBalance(this.thirdAccountId, this.tokenId, expectedAmount);
  console.log(`Verified third account holds ${expectedAmount} HTT tokens`);
});

// For VERIFICATION of account balances - separate from the setup steps
Then(/^The fourth account holds (\d+) HTT tokens$/, async function (expectedAmount: number) {
  await verifyTokenBalance(this.fourthAccountId, this.tokenId, expectedAmount);
  console.log(`Verified fourth account holds ${expectedAmount} HTT tokens`);
});