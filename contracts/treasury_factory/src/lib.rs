#![no_std]
//! Eunomia Treasury Factory
//!
//! One signature from zero to an autonomous agent. Creating a treasury used to be five
//! owner-signed transactions (deploy, register, fund, approve payee, start the Leash) —
//! seven passkey prompts for a new user. `create` does all of it in a single invocation:
//! the owner authorises the root call once, and every sub-call the treasury, the token
//! and the registry require from the owner hangs off that one authorisation tree.
//!
//! The factory holds no funds and has no admin. It only knows which treasury code to
//! instantiate (the wasm hash the app ships), where the registry is and the deposit cap
//! every treasury it creates carries — all fixed at deploy time, so a factory can never be
//! re-pointed at different code or loosened after users trusted it.
//!
//! v4: the setup also carries the monthly budget and per-payee monthly caps, and funding
//! goes through the treasury's capped `deposit` rather than a bare transfer.
use soroban_sdk::{
    contract, contractclient, contractimpl, contracttype, symbol_short, Address, BytesN,
    Env, Vec,
};

/// A time-bound, spend-capped agent credential to start the treasury with (the Leash).
#[contracttype]
#[derive(Clone)]
pub struct Leash {
    pub agent: Address,
    pub valid_until: u64,
    pub limit: i128,
}

/// A monthly ceiling on what one payee may receive (v4).
#[contracttype]
#[derive(Clone)]
pub struct PayeeCap {
    pub payee: Address,
    pub cap: i128,
}

/// Everything a treasury needs to be useful on the first ledger it exists in.
#[contracttype]
#[derive(Clone)]
pub struct Setup {
    /// Owner of the funds: becomes the treasury's admin AND root agent (as the app did).
    pub owner: Address,
    /// SEP-41 / SAC token the treasury holds and spends.
    pub token: Address,
    pub daily_limit: i128,
    pub per_task_limit: i128,
    /// Most the agent may move per UTC calendar month (0 = no monthly limit).
    pub monthly_limit: i128,
    /// Payees approved from the start (may be empty).
    pub payees: Vec<Address>,
    /// Monthly caps on individual payees (may be empty). A cap does not approve its payee.
    pub payee_caps: Vec<PayeeCap>,
    /// Start a Leash for an agent key right away: empty = none, one entry = that agent.
    /// (A `Vec` rather than an `Option`: the SDK's spec cannot carry an optional struct.)
    pub leash: Vec<Leash>,
    /// Amount of `token` deposited from the owner into the treasury (0 = unfunded). Refused
    /// as a whole if it exceeds the factory's deposit cap.
    pub fund: i128,
    /// Record the treasury under the owner in the registry (cross-device recovery).
    pub register: bool,
    /// Caller-chosen; the treasury address is derived from the factory and this salt.
    pub salt: BytesN<32>,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    TreasuryWasm,
    Registry,
    DepositCap,
}

/// The slice of the treasury interface the factory drives. Both calls are admin-only on
/// the treasury, so each one becomes a sub-invocation under the owner's authorisation.
#[contractclient(name = "TreasuryClient")]
pub trait TreasuryApi {
    fn add_payee(env: Env, payee: Address);
    fn set_session(env: Env, agent: Address, valid_until: u64, limit: i128);
    fn set_monthly_limit(env: Env, limit: i128);
    fn set_payee_cap(env: Env, payee: Address, cap: i128);
    fn deposit(env: Env, from: Address, amount: i128);
}

#[contractclient(name = "RegistryClient")]
pub trait RegistryApi {
    fn register(env: Env, owner: Address, treasury: Address);
}

#[contract]
pub struct TreasuryFactory;

#[contractimpl]
impl TreasuryFactory {
    /// Pins the treasury code, the registry and the deposit cap. Immutable after deploy (no
    /// setters): a factory that could be re-pointed would be a way to hand users different
    /// code, and one whose cap could be raised would make the beta bound a promise only.
    pub fn __constructor(env: Env, treasury_wasm: BytesN<32>, registry: Address, deposit_cap: i128) {
        if deposit_cap < 0 {
            panic!("deposit cap must not be negative");
        }
        env.storage()
            .instance()
            .set(&DataKey::TreasuryWasm, &treasury_wasm);
        env.storage().instance().set(&DataKey::Registry, &registry);
        env.storage().instance().set(&DataKey::DepositCap, &deposit_cap);
    }

    /// The deposit cap every treasury from this factory is born with (0 = uncapped).
    pub fn deposit_cap(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::DepositCap).unwrap_or(0)
    }

    pub fn treasury_wasm(env: Env) -> BytesN<32> {
        env.storage().instance().get(&DataKey::TreasuryWasm).unwrap()
    }

    pub fn registry(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Registry).unwrap()
    }

    /// Deploy a treasury and set it up — one owner signature for the whole thing.
    ///
    /// Order matters for atomicity only in the sense that any refusal (an incoherent
    /// policy in the constructor, an invalid Leash, an unfunded owner) aborts the entire
    /// transaction: no half-configured treasury can exist.
    pub fn create(env: Env, s: Setup) -> Address {
        s.owner.require_auth();
        if s.leash.len() > 1 {
            panic!("at most one Leash");
        }
        let wasm: BytesN<32> = env.storage().instance().get(&DataKey::TreasuryWasm).unwrap();
        let registry: Address = env.storage().instance().get(&DataKey::Registry).unwrap();
        let deposit_cap: i128 = env.storage().instance().get(&DataKey::DepositCap).unwrap_or(0);

        // 1. The treasury: constructor validates the policy (InvalidLimits aborts here).
        let treasury = env.deployer().with_current_contract(s.salt.clone()).deploy_v2(
            wasm,
            (
                s.owner.clone(),
                s.owner.clone(),
                s.token.clone(),
                s.daily_limit,
                s.per_task_limit,
                deposit_cap,
            ),
        );
        let t = TreasuryClient::new(&env, &treasury);

        // 2. Approved payees, their caps, and the monthly budget.
        for payee in s.payees.iter() {
            t.add_payee(&payee);
        }
        for c in s.payee_caps.iter() {
            t.set_payee_cap(&c.payee, &c.cap);
        }
        if s.monthly_limit != 0 {
            t.set_monthly_limit(&s.monthly_limit);
        }

        // 3. The Leash (an agent key the owner already holds the public half of).
        if let Some(l) = s.leash.first() {
            t.set_session(&l.agent, &l.valid_until, &l.limit);
        }

        // 4. Funding, straight from the owner through the capped deposit — the treasury never
        //    touches the owner's key; the owner's signature covers the transfer inside it.
        if s.fund > 0 {
            t.deposit(&s.owner, &s.fund);
        }

        // 5. Cross-device discovery.
        if s.register {
            RegistryClient::new(&env, &registry).register(&s.owner, &treasury);
        }

        env.events()
            .publish((symbol_short!("created"), s.owner), treasury.clone());
        treasury
    }
}

mod test;
