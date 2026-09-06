# Quorum Vault

An M-of-N multi-signature wallet, built with Hardhat.

Owners submit transactions, other owners confirm them, and once the confirmation count reaches the threshold anyone can execute. The owner set and the threshold are themselves changed through the same flow — the wallet governs itself.

---

## API

### Deployment

```solidity
constructor(address[] memory _owners, uint128 _threshold)
```

Sets the initial owner set and the number of confirmations required to execute. Rejects an empty owner list, the zero address, duplicates, a threshold outside `1..owners.length`, and more than ten owners.

### Receiving funds

```solidity
receive() external payable
```

Accepts ETH from anyone and emits `Deposit`. No approval is involved on the way in — only on the way out.

### Proposing and approving

```solidity
function submitTx(address to, uint value, uint gas, bytes calldata data) external   // onlyOwner
```

Records a transaction and counts as the proposer's own confirmation, so a proposal starts at one approval rather than zero. `gas` is the minimum gas that must remain when the call is finally made; pass `0` to skip that check. Returns nothing — the index is `transactions.length - 1` and is carried by the `SubmitTransaction` event.

```solidity
function confirmTx(uint txIndex) external      // onlyOwner, txExists
function revokeConfirmation(uint txIndex) external   // onlyOwner, txExists
```

Add or withdraw an approval. Both reject a transaction that has already executed. `confirmTx` rejects a second confirmation from the same owner, and `revokeConfirmation` rejects an owner who has not confirmed.

### Executing

```solidity
function executeTx(uint txIndex) external      // txExists
```

Runs the transaction once `numConfirmations(txIndex) >= threshold`. **Not restricted to owners** — the authorization has already been collected on-chain, so anyone may pay the gas to push it through.

The transaction is marked executed before the outbound call and unmarked if that call fails, which means a failed transaction can be retried later without collecting confirmations again. When a non-zero `gas` was supplied at submission, execution reverts unless at least that much gas remains; without it, anyone could execute an approved transaction with just enough gas to reach the call but not enough to complete it, burning the approval on a guaranteed failure.

The call is made in assembly so that return data is never copied into memory, which stops a malicious target from inflating the caller's gas cost with a large return payload.

### Self-governance

```solidity
function addOwner(address newOwner, bool isAddNCR) external   // onlyWallet
function removeOwner(address targetOwner) external            // onlyWallet
function changeThreshold(uint128 newNum) external             // onlyWallet
```

All three require `msg.sender == address(this)`, so they can only be reached by a transaction that already cleared the threshold. To add an owner, the current owners submit a transaction targeting the wallet itself with `abi.encodeWithSelector(this.addOwner.selector, ...)` as the calldata.

`addOwner` raises the threshold by one when `isAddNCR` is true, which keeps the ratio from silently loosening as the wallet grows. `removeOwner` lowers the threshold if it would otherwise exceed the remaining owner count, and refuses to remove the last owner.

### Views

```solidity
function numConfirmations(uint txIndex) public view returns (uint)   // txExists
```

Counts current approvals by walking the owner list. It is computed rather than stored, because a stored counter would go stale the moment the owner set changed.

```solidity
uint128 public threshold;
address[] public owners;
Transaction[] public transactions;
mapping(address => bool) public isOwner;
mapping(address => uint) public ownerNonce;
mapping(uint => mapping(address => uint)) public isConfirmed;
```

---

## Design Notes

### Confirmations are invalidated by an owner nonce

Each owner receives an incrementing nonce when added. A confirmation is stored as the owner's nonce at the time it was given:

```solidity
isConfirmed[txIndex][owner] = ownerNonce[owner];
```

and only counts while it still equals that owner's current nonce. Removing an owner and adding them back issues a fresh nonce, so every confirmation they left behind stops counting at once — without iterating the transaction history to clear it. This is why `isConfirmed` maps to `uint` rather than `bool`.

### Limits

| Rule | Enforced in |
|---|---|
| `0 < threshold <= owners.length` | `constructor`, `changeThreshold` |
| At most 10 owners | `constructor`, `addOwner` |
| No zero address, no duplicates | `constructor`, `addOwner` |
| At least one owner must remain | `removeOwner` |
| Threshold follows the owner count downward | `removeOwner` |

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Installation

```shell
git clone https://github.com/jinzm10162/Quorum-Vault.git
cd Multisig-Wallet
npm install
```

### Usage

```shell
npx hardhat compile         # compile contracts
npm test                    # run the test suite
npx hardhat node            # start a local node
REPORT_GAS=true npm test    # run tests with a gas report
```

---


## Project Structure

```
contracts/
└── MultiSigWallet.sol       Owners, confirmations, execution, self-governance

test/
└── MultiSigWallet.js        45 tests
```

Solidity `0.8.28`. No external dependencies.

---

## Notes

Unaudited learning project. Do not deploy to mainnet or use with real funds.

## License

MIT
