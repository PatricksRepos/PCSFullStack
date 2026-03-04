// src/component/WalletTokenTx.js
import React, { useEffect, useState } from "react";
import PropTypes from 'prop-types';
import {
    Address,
    AssetName,
    Assets,
    BigNum,
    CoinSelectionStrategyCIP2,
    LinearFee,
    MultiAsset,
    ScriptHash,
    Transaction,
    TransactionBuilder,
    TransactionBuilderConfigBuilder,
    TransactionOutput,
    TransactionUnspentOutput,
    TransactionUnspentOutputs,
    TransactionWitnessSet,
    Value,
} from "@emurgo/cardano-serialization-lib-asmjs";
import { Buffer } from "buffer";
import '/home/patrick/dev/PCS_FULLSTACK_REACT_V3/src/App.css';
import { Alert, Button, Form, Spinner } from "react-bootstrap";

function WalletTokenTx({ asset, wallet, onClose, assets, onSelectAsset }) {
    const [toAddress, setToAddress] = useState("");
    const [selectedAsset, setSelectedAsset] = useState(asset || null);
    const [policyIdState, setPolicyIdState] = useState("");
    const [assetNameHex, setAssetNameHex] = useState("");
    const [tokenAmount, setTokenAmount] = useState(0);
    const [adaAmount, setAdaAmount] = useState(2000000); // 2 ADA in lovelaces
    const [txHash, setTxHash] = useState(null);
    const [error, setError] = useState(null);
    const [image, setImage] = useState("");
    const [metadata, setMetadata] = useState({});
    const [isSubmitting, setIsSubmitting] = useState(false); // New State for Submission

    // Debugging: Log received props
    useEffect(() => {
        console.log("WalletTokenTx Props:", { asset, wallet, assets });
    }, [asset, wallet, assets]);

    // Update asset details whenever 'selectedAsset' changes
    useEffect(() => {
        if (selectedAsset) {
            setPolicyIdState(selectedAsset.policyID);
            setAssetNameHex(selectedAsset.assetNameHex);
            setTokenAmount(selectedAsset.amount);
            setImage(selectedAsset.imageUrl || ""); // Changed to imageUrl
            setMetadata(selectedAsset.metadata || {});
            console.log("Asset set:", selectedAsset);
        } else {
            // If no asset is selected, reset state variables
            setPolicyIdState("");
            setAssetNameHex("");
            setTokenAmount(0);
            setImage("");
            setMetadata({});
            console.log("No asset selected, resetting fields.");
        }
    }, [selectedAsset]);

    // Handle asset selection from the dropdown
    const handleAssetChange = (e) => {
        const selectedAssetId = e.target.value;
        console.log("Selected Asset ID:", selectedAssetId); // Debugging

        const asset = assets.find((a) => a.assetID === selectedAssetId);
        console.log("Found Asset:", asset); // Debugging

        setSelectedAsset(asset); // Update selectedAsset state

        // Call the callback function only if it exists
        if (typeof onSelectAsset === "function") {
            onSelectAsset(asset);
        }
    };

    /**
     * Handle sending token transaction.
     */
    const handleSendTokenTransaction = async () => {
        if (!wallet) {
            setError("Wallet is not connected.");
            return;
        }

        try {
            setError(null);
            setIsSubmitting(true);
            console.log("Preparing token transaction...");

            // Validate inputs
            if (
                !toAddress.trim() ||
                !policyIdState.trim() ||
                !assetNameHex.trim() ||
                tokenAmount <= 0 ||
                adaAmount <= 0
            ) {
                throw new Error("All fields are required, and values must be positive.");
            }
            console.log("Inputs validated:", {
                toAddress,
                policyIdState,
                assetNameHex,
                tokenAmount,
                adaAmount,
            });

            // Fetch protocol parameters
            const response = await fetch("/protocolParameters");
            if (!response.ok) {
                throw new Error("Failed to fetch protocol parameters.");
            }
            const protocolParameters = await response.json();
            console.log("Fetched protocol parameters:", protocolParameters);

            // Configure transaction builder
            const txBuilderConfig = TransactionBuilderConfigBuilder.new()
                .fee_algo(
                    LinearFee.new(
                        BigNum.from_str(protocolParameters.min_fee_a.toString()),
                        BigNum.from_str(protocolParameters.min_fee_b.toString())
                    )
                )
                .coins_per_utxo_word(
                    BigNum.from_str(protocolParameters.coins_per_utxo_word.toString())
                )
                .pool_deposit(BigNum.from_str(protocolParameters.pool_deposit.toString()))
                .key_deposit(BigNum.from_str(protocolParameters.key_deposit.toString()))
                .max_value_size(protocolParameters.max_val_size)
                .max_tx_size(protocolParameters.max_tx_size)
                .prefer_pure_change(true)
                .build();
            console.log("Transaction builder configured with:", txBuilderConfig);

            const txBuilder = TransactionBuilder.new(txBuilderConfig);

            // Prepare recipient address
            const recipient = Address.from_bech32(toAddress.trim());
            console.log("Recipient address prepared:", recipient.to_bech32());

            // Prepare multi-asset for tokens
            const multiAsset = MultiAsset.new();
            const assetsMap = Assets.new();
            assetsMap.insert(
                AssetName.new(Buffer.from(assetNameHex.trim(), "hex")),
                BigNum.from_str(tokenAmount.toString())
            );
            multiAsset.insert(
                ScriptHash.from_bytes(Buffer.from(policyIdState.trim(), "hex")),
                assetsMap
            );
            console.log("Multi-asset prepared:", multiAsset);

            // Add ADA to meet protocol requirements
            const adaAmountBN = BigNum.from_str(adaAmount.toString());
            const value = Value.new(adaAmountBN);
            value.set_multiasset(multiAsset);
            txBuilder.add_output(TransactionOutput.new(recipient, value));
            console.log("Transaction output prepared with ADA amount:", value.to_json());

            // Fetch UTXOs and add inputs
            const utxosHex = await wallet.api.getUtxos();
            if (!utxosHex || utxosHex.length === 0) {
                throw new Error("No UTXOs available for transaction.");
            }
            console.log("Fetched UTXOs:", utxosHex);

            const transactionUnspentOutputs = TransactionUnspentOutputs.new();
            utxosHex.forEach((utxoHex) => {
                transactionUnspentOutputs.add(
                    TransactionUnspentOutput.from_hex(utxoHex)
                );
            });

            txBuilder.add_inputs_from(
                transactionUnspentOutputs,
                CoinSelectionStrategyCIP2.RandomImproveMultiAsset
            );
            console.log("Added inputs to transaction.");

            // Fetch and validate the change address
            const changeAddressHex = await wallet.api.getChangeAddress();
            if (!changeAddressHex) {
                throw new Error("Change address is invalid or missing.");
            }
            const changeAddress = Address.from_hex(changeAddressHex.trim());
            txBuilder.add_change_if_needed(changeAddress);
            console.log("Change address added:", changeAddress.to_bech32());

            // Build the transaction body
            const txBody = txBuilder.build();
            console.log("Transaction body built:", txBody.to_json());

            // Create an unsigned transaction
            const unsignedTx = Transaction.new(txBody, TransactionWitnessSet.new());
            const unsignedTxHex = unsignedTx.to_hex();
            console.log("Unsigned transaction hex:", unsignedTxHex);

            // Sign the transaction
            const signedWitnessSetHex = await wallet.api.signTx(unsignedTxHex, true);
            console.log("Signed witness set hex:", signedWitnessSetHex);

            const signedWitnessSet = TransactionWitnessSet.from_bytes(
                Buffer.from(signedWitnessSetHex, "hex")
            );

            // Merge signed transaction body and witness set
            const signedTx = Transaction.new(
                txBody,
                signedWitnessSet
            );
            const signedTxHexFinal = signedTx.to_hex();
            console.log("Signed transaction hex:", signedTxHexFinal);

            // Submit the transaction
            const submittedTxHash = await wallet.api.submitTx(signedTxHexFinal);
            console.log("Transaction submitted successfully. TxHash:", submittedTxHash);

            setTxHash(submittedTxHash);
        } catch (err) {
            console.error("Transaction failed:", err);
            setError(err.message || "An error occurred while submitting the transaction.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div
            className="container mt-4"
            style={{
                color: "#fff",
                backgroundColor: "#333",
                padding: "20px",
                borderRadius: "8px",
            }}
        >
            <h3 className="text-center mb-4">Send Token Transaction</h3>

            {/* Asset Information Display */}
            {selectedAsset && (
                <div style={{ flex: "0 0 200px", textAlign: "center" }}>
                    {image ? (
                        <img
                            src={image}
                            alt={selectedAsset.assetName}
                            style={{
                                width: "200px",
                                height: "200px",
                                objectFit: "cover",
                                borderRadius: "8px",
                                marginBottom: "10px",
                            }}
                            onError={(e) => {
                                e.target.onerror = null;
                                e.target.src = 'https://example.com/default-image.png';
                            }}
                        />
                    ) : (
                        <div
                            style={{
                                width: "200px",
                                height: "200px",
                                backgroundColor: "#ddd",
                                borderRadius: "8px",
                                marginBottom: "10px",
                            }}
                        />
                    )}
                    <p><strong>Asset Name:</strong> {selectedAsset.assetName}</p>
                    <p><strong>Policy ID:</strong> {selectedAsset.policyID}</p>
                    <p><strong>Amount:</strong> {selectedAsset.amount}</p>
                </div>
            )}

            <Form>
                {/* Recipient Address */}
                <Form.Group className="mb-3" controlId="toAddress">
                    <Form.Label>Recipient Address</Form.Label>
                    <Form.Control
                        type="text"
                        placeholder="Enter recipient wallet address"
                        value={toAddress}
                        onChange={(e) => setToAddress(e.target.value)}
                        required
                        style={{
                            backgroundColor: "#444",
                            color: "#fff",
                            border: "1px solid #666",
                        }}
                    />
                </Form.Group>

                {/* Asset Selector Dropdown */}
                <Form.Group className="mb-3" controlId="assetSelector">
                    <Form.Label>Select Asset</Form.Label>
                    <Form.Select
                        value={selectedAsset ? selectedAsset.assetID : ""}
                        onChange={handleAssetChange}
                        required
                        style={{
                            backgroundColor: "#444",
                            color: "#fff",
                            border: "1px solid #666",
                        }}
                    >
                        <option value="">Select Asset</option>
                        {Array.isArray(assets) && assets.length > 0 ? (
                            assets.map((assetItem) => (
                                <option key={assetItem.assetID} value={assetItem.assetID}>
                                    {assetItem.assetName || "Unknown Asset"} ({assetItem.policyID})
                                </option>
                            ))
                        ) : (
                            <option disabled>No assets available</option>
                        )}
                    </Form.Select>
                </Form.Group>

                {/* Display Policy ID */}
                <Form.Group className="mb-3" controlId="policyId">
                    <Form.Label>Asset Policy ID</Form.Label>
                    <Form.Control
                        type="text"
                        value={policyIdState}
                        readOnly
                        style={{
                            backgroundColor: "#444",
                            color: "#fff",
                            border: "1px solid #666",
                        }}
                    />
                </Form.Group>

                {/* Display Asset Name (Hex) */}
                <Form.Group className="mb-3" controlId="assetNameHex">
                    <Form.Label>Asset Name (Hex)</Form.Label>
                    <Form.Control
                        type="text"
                        value={assetNameHex}
                        readOnly
                        style={{
                            backgroundColor: "#444",
                            color: "#fff",
                            border: "1px solid #666",
                        }}
                    />
                </Form.Group>

                {/* Asset Image */}
                {image && (
                    <div className="mb-3 text-center">
                        <img
                            src={image}
                            alt="Asset"
                            style={{ maxWidth: "200px", maxHeight: "200px" }}
                            onError={(e) => {
                                e.target.onerror = null;
                                e.target.src = 'https://example.com/default-image.png';
                            }}
                        />
                    </div>
                )}

                {/* Asset Metadata */}
                {metadata && metadata.description && (
                    <Form.Group className="mb-3" controlId="metadataDescription">
                        <Form.Label>Description</Form.Label>
                        <Form.Control
                            as="textarea"
                            rows={3}
                            value={metadata.description}
                            readOnly
                            style={{
                                backgroundColor: "#444",
                                color: "#fff",
                                border: "1px solid #666",
                            }}
                        />
                    </Form.Group>
                )}

                {/* Token Amount */}
                <Form.Group className="mb-3" controlId="tokenAmount">
                    <Form.Label>Token Amount</Form.Label>
                    <Form.Control
                        type="number"
                        value={tokenAmount}
                        onChange={(e) => setTokenAmount(Number(e.target.value))}
                        required
                        min="1"
                        style={{
                            backgroundColor: "#444",
                            color: "#fff",
                            border: "1px solid #666",
                        }}
                    />
                </Form.Group>

                {/* ADA Amount */}
                <Form.Group className="mb-3" controlId="adaAmount">
                    <Form.Label>ADA Amount (Lovelace)</Form.Label>
                    <Form.Control
                        type="number"
                        value={adaAmount}
                        onChange={(e) => setAdaAmount(Number(e.target.value))}
                        required
                        min="2000000" // Minimum 2 ADA
                        style={{
                            backgroundColor: "#444",
                            color: "#fff",
                            border: "1px solid #666",
                        }}
                    />
                </Form.Group>

                {/* Error Message */}
                {error && (
                    <Alert variant="danger" onClose={() => setError(null)} dismissible>
                        {error}
                    </Alert>
                )}

                {/* Action Buttons */}
                <div className="d-flex justify-content-center">
                    <Button
                        type="button"
                        variant="primary"
                        onClick={handleSendTokenTransaction}
                        disabled={!toAddress || !selectedAsset || tokenAmount <= 0 || isSubmitting}
                        style={{ marginRight: '10px' }}
                    >
                        {isSubmitting ? (
                            <>
                                <Spinner
                                    as="span"
                                    animation="border"
                                    size="sm"
                                    role="status"
                                    aria-hidden="true"
                                /> Sending...
                            </>
                        ) : (
                            "Send Token"
                        )}
                    </Button>
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={onClose}
                        className="ms-3"
                    >
                        Cancel
                    </Button>
                </div>
            </Form>

            {/* Transaction Hash Display */}
            {txHash && (
                <div className="mt-3 text-center">
                    <p>Transaction submitted successfully! Transaction Hash:</p>
                    <a
                        href={`https://cardanoscan.io/transaction/${txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        {txHash}
                    </a>
                </div>
            )}
        </div>
    )
}

WalletTokenTx.propTypes = {
    asset: PropTypes.object,
    wallet: PropTypes.object.isRequired,
    onClose: PropTypes.func.isRequired,
    assets: PropTypes.array.isRequired,
    onSelectAsset: PropTypes.func,
};

WalletTokenTx.defaultProps = {
    assets: [],
};

export default WalletTokenTx;
