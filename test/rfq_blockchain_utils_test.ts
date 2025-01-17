import { artifacts as erc20Artifacts, DummyERC20TokenContract } from '@0x/contracts-erc20';
import { expect } from '@0x/contracts-test-utils';
import { artifacts as zeroExArtifacts, fullMigrateAsync, IZeroExContract } from '@0x/contracts-zero-ex';
import { Web3ProviderEngine } from '@0x/dev-utils';
import { RfqOrder, Signature } from '@0x/protocol-utils';
import { BigNumber } from '@0x/utils';
import { Web3Wrapper } from '@0x/web3-wrapper';
import 'mocha';

import { PROTOCOL_FEE_MULTIPLIER } from '../src/config';
import { ChainId } from '../src/types';
import { RfqBlockchainUtils } from '../src/utils/rfq_blockchain_utils';

import { getProvider } from './constants';
import { setupDependenciesAsync, teardownDependenciesAsync } from './utils/deployment';

const SUITE_NAME = 'RFQ Blockchain Utils Test';

const GAS_PRICE = 1e9;
const VALID_EXPIRY = new BigNumber(9000000000);
const CHAIN_ID = ChainId.Ganache;

describe(SUITE_NAME, () => {
    let provider: Web3ProviderEngine;
    let makerToken: DummyERC20TokenContract;
    let takerToken: DummyERC20TokenContract;
    let takerAmount: BigNumber;
    let invalidTakerAmount: BigNumber;
    let makerAmount: BigNumber;
    let web3Wrapper: Web3Wrapper;
    let owner: string;
    let maker: string;
    let taker: string;
    let txOrigin: string;
    let zeroEx: IZeroExContract;
    let rfqOrder: RfqOrder;
    let unfillableRfqOrder: RfqOrder;
    let rfqBlockchainUtils: RfqBlockchainUtils;
    let orderSig: Signature;
    let sigForUnfillableOrder: Signature;

    before(async () => {
        await setupDependenciesAsync(SUITE_NAME);
        provider = getProvider();
        web3Wrapper = new Web3Wrapper(provider);

        [owner, maker, taker, txOrigin] = await web3Wrapper.getAvailableAddressesAsync();

        makerToken = await DummyERC20TokenContract.deployFrom0xArtifactAsync(
            erc20Artifacts.DummyERC20Token,
            provider,
            { from: maker, gas: 10000000 },
            {},
            'The token that originally belongs to the maker',
            'makerToken',
            new BigNumber(18),
            new BigNumber(1000000),
        );

        takerToken = await DummyERC20TokenContract.deployFrom0xArtifactAsync(
            erc20Artifacts.DummyERC20Token,
            provider,
            { from: taker, gas: 10000000 },
            {},
            'The token that originally belongs to the maker',
            'takerToken',
            new BigNumber(18),
            new BigNumber(1000000),
        );

        makerAmount = new BigNumber(100);
        takerAmount = new BigNumber(50);
        invalidTakerAmount = new BigNumber(100);

        zeroEx = await fullMigrateAsync(
            owner,
            provider,
            { from: owner, gasPrice: GAS_PRICE },
            {},
            { protocolFeeMultiplier: Number(PROTOCOL_FEE_MULTIPLIER) },
            {
                nativeOrders: zeroExArtifacts.NativeOrdersFeature,
                metaTransactions: zeroExArtifacts.MetaTransactionsFeature,
            },
        );

        rfqOrder = new RfqOrder({
            makerToken: makerToken.address,
            takerToken: takerToken.address,
            makerAmount,
            takerAmount,
            maker,
            taker,
            txOrigin,
            expiry: VALID_EXPIRY,
            salt: new BigNumber(1),
            verifyingContract: zeroEx.address,
            chainId: CHAIN_ID,
        });
        orderSig = await rfqOrder.getSignatureWithProviderAsync(provider);

        unfillableRfqOrder = new RfqOrder({
            makerToken: makerToken.address,
            takerToken: takerToken.address,
            makerAmount,
            takerAmount: invalidTakerAmount,
            maker,
            taker,
            txOrigin,
            expiry: VALID_EXPIRY,
            salt: new BigNumber(1),
            verifyingContract: zeroEx.address,
            chainId: CHAIN_ID,
        });
        sigForUnfillableOrder = await unfillableRfqOrder.getSignatureWithProviderAsync(provider);

        await makerToken.mint(makerAmount).awaitTransactionSuccessAsync({ from: maker });
        await makerToken
            .approve(zeroEx.address, makerAmount)
            .awaitTransactionSuccessAsync({ from: maker });
        await takerToken.mint(takerAmount).awaitTransactionSuccessAsync({ from: taker });
        await takerToken
            .approve(zeroEx.address, takerAmount)
            .awaitTransactionSuccessAsync({ from: taker });

        rfqBlockchainUtils = new RfqBlockchainUtils(zeroEx);
    });

    after(async () => {
        await teardownDependenciesAsync(SUITE_NAME);
    });

    describe('validateMetaTransaction', () => {
        it('returns true for a valid metatransaction', async () => {
            const metaTx = rfqBlockchainUtils.generateMetaTransaction(rfqOrder, orderSig, taker, takerAmount, CHAIN_ID);
            const metaTxSig = await metaTx.getSignatureWithProviderAsync(provider);

            expect(await rfqBlockchainUtils.validateMetaTransactionOrThrowAsync(metaTx, metaTxSig, txOrigin)).to.deep.eq([takerAmount, makerAmount]);
        });
        it('returns error for a metatransaction with an invalid signature', async () => {
            const metaTx = rfqBlockchainUtils.generateMetaTransaction(rfqOrder, orderSig, taker, takerAmount, CHAIN_ID);
            const invalidMetaTxSig = orderSig;

            try {
                await rfqBlockchainUtils.validateMetaTransactionOrThrowAsync(metaTx, invalidMetaTxSig, txOrigin);
                expect.fail(`validateMetaTransactionOrThrowAsync should throw an error when the signature is invalid`);
            } catch (err) {
                expect(String(err)).to.contain('SignatureValidationError');
            }
        });
        it('returns error for a metatransaction with an unfillable order', async () => {
            const metaTx = rfqBlockchainUtils.generateMetaTransaction(unfillableRfqOrder, sigForUnfillableOrder, taker, invalidTakerAmount, CHAIN_ID);
            const metaTxSig = await metaTx.getSignatureWithProviderAsync(provider);

            try {
                await rfqBlockchainUtils.validateMetaTransactionOrThrowAsync(metaTx, metaTxSig, txOrigin);
                expect.fail(`validateMetaTransactionOrThrowAsync should throw an error when the order is unfillable`);
            } catch (err) {
                expect(String(err)).to.contain('MetaTransactionCallFailedError');
            }
        });
    });
});
