//! tUSD: a TEST dollar stablecoin for Cautio's testnet demo. NEP-141, 6 decimals like USDC.
//! Anyone may mint test tokens for themselves. This contract holds no value and must never be used on mainnet:
//! on mainnet Cautio points at a real stablecoin such as USDC instead.
use near_contract_standards::fungible_token::metadata::{FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC};
use near_contract_standards::fungible_token::FungibleToken;
use near_contract_standards::storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement};
use near_contract_standards::impl_fungible_token_core;
use near_sdk::borsh::BorshSerialize;
use near_sdk::json_types::U128;
use near_sdk::store::LazyOption;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue};

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum Key {
    Token,
    Meta,
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct Contract {
    token: FungibleToken,
    meta: LazyOption<FungibleTokenMetadata>,
}

#[near]
impl Contract {
    #[init]
    pub fn new() -> Self {
        let meta = FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Test Dollar (Cautio testnet)".to_string(),
            symbol: "tUSD".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 6,
        };
        Self { token: FungibleToken::new(Key::Token), meta: LazyOption::new(Key::Meta, Some(meta)) }
    }

    /// Testnet faucet: mint up to 10,000 tUSD per call to any account (registers it if needed).
    #[payable]
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        require!(amount.0 <= 10_000_000_000, "faucet limit is 10,000 tUSD per call");
        if !self.token.accounts.contains_key(&account_id) {
            self.token.internal_register_account(&account_id);
        }
        self.token.internal_deposit(&account_id, amount.0);
    }
}

impl_fungible_token_core!(Contract, token);
#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }
    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }
    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.storage_unregister(force)
    }
    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }
    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.meta.get().clone().unwrap_or_else(|| env::panic_str("no metadata"))
    }
}
