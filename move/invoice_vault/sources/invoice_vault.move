module invoice_vault::invoice_vault {
  use iota::dynamic_field;
  use iota_notarization::{method, notarization};
  use std::string::{Self, String};

  const E_NOT_ISSUER: u64 = 1;
  const E_INVALID_STATUS: u64 = 2;
  const E_NOT_ALLOWED: u64 = 3;
  const E_INVALID_PRICE: u64 = 4;
  const E_INVALID_AMOUNT: u64 = 5;
  const E_INVALID_PAYMENT: u64 = 6;
  const E_SELF_FUNDING: u64 = 7;
  const E_NOT_HOLDER: u64 = 8;
  const E_INVALID_RATING: u64 = 9;
  const E_ALREADY_RATED: u64 = 10;
  const E_NOT_REPAID: u64 = 11;
  const E_NOT_SIMULATION: u64 = 12;
  const E_NOT_DUE_FOR_DEFAULT: u64 = 13;
  const E_DUPLICATE_HASH: u64 = 14;
  const E_INVALID_NOTARIZATION: u64 = 15;
  const E_INVALID_NOTARIZATION_METHOD: u64 = 16;
  const E_NOTARIZATION_HASH_MISMATCH: u64 = 17;
  const E_INVALID_NOTARIZATION_SCHEMA: u64 = 18;
  const E_INVALID_REGISTRY: u64 = 19;
  const PLATFORM_FEE_BPS: u64 = 75; // 0.75%
  const DEFAULT_FEE_BPS: u64 = 800; // 8.0%, 100% to holder in simulation mode.
  const DUE_OFFSET_SEC_SIMULATION: u64 = 30;
  const BPS_DENOMINATOR: u64 = 10000;
  const PDF_SHA256_BYTE_LEN: u64 = 32;
  const TREASURY_ADDRESS: address = @0x777a042ce80d4aaa59d69741775247f5131587e6654c7bc975bda804cd03b06b;

  const STATUS_OPEN: u8 = 0;
  const STATUS_FUNDED: u8 = 1;
  const STATUS_REPAID: u8 = 2;
  const STATUS_CANCELLED: u8 = 3;
  const STATUS_DEFAULTED: u8 = 4;
  const STATUS_RECOVERED: u8 = 5;

  /// One-time witness used to initialize the shared invoice registry at publish time.
  public struct INVOICE_VAULT has drop {}

  public struct InvoiceRegistry has key, store {
    id: UID
  }

  public struct Invoice has key, store {
    id: UID,
    registry_id: address,
    issuer: address,
    holder: address,
    notarization_id: address,
    invoice_hash: vector<u8>,
    amount: u64,
    due_date: u64,
    discount_price: u64,
    rating_score: u8,
    rated_by: address,
    auto_default_rating: bool,
    allowlist: vector<address>,
    denylist: vector<address>,
    status: u8,
    simulation_mode: bool,
    was_defaulted: bool,
    funded_at_ms: u64,
    defaulted_at_ms: u64,
    recovered_at_ms: u64
  }

  public struct RegistryCreated has copy, drop {
    registry_id: address
  }

  public struct InvoiceCreated has copy, drop {
    invoice_id: address,
    registry_id: address,
    issuer: address,
    notarization_id: address,
    invoice_hash: vector<u8>,
    amount: u64,
    due_date: u64,
    simulation_mode: bool
  }

  public struct InvoiceDefaulted has copy, drop {
    invoice_id: address,
    issuer: address,
    holder: address,
    due_date: u64,
    defaulted_at_ms: u64
  }

  public struct InvoiceRecovered has copy, drop {
    invoice_id: address,
    issuer: address,
    holder: address,
    repaid_amount: u64,
    default_fee: u64,
    recovered_at_ms: u64
  }

  fun init(_otw: INVOICE_VAULT, ctx: &mut TxContext) {
    let registry = InvoiceRegistry { id: object::new(ctx) };
    let registry_id = object::id_address(&registry);
    transfer::share_object(registry);
    iota::event::emit(RegistryCreated { registry_id });
  }

  /// create_invoice(registry, notarization, hash, amount, due_date)
  public entry fun create_invoice(
    registry: &mut InvoiceRegistry,
    notarization_ref: &notarization::Notarization<vector<u8>>,
    invoice_hash: vector<u8>,
    amount: u64,
    due_date: u64,
    ctx: &mut TxContext
  ) {
    create_invoice_internal(
      registry,
      notarization_ref,
      invoice_hash,
      amount,
      due_date,
      false,
      ctx,
    );
  }

  /// create_invoice_simulation(registry, notarization, hash, amount, due_date)
  /// Same as create_invoice, but enables demo default simulation logic.
  public entry fun create_invoice_simulation(
    registry: &mut InvoiceRegistry,
    notarization_ref: &notarization::Notarization<vector<u8>>,
    invoice_hash: vector<u8>,
    amount: u64,
    due_date: u64,
    ctx: &mut TxContext
  ) {
    create_invoice_internal(
      registry,
      notarization_ref,
      invoice_hash,
      amount,
      due_date,
      true,
      ctx,
    );
  }

  /// list_for_funding(discount_price)
  public entry fun list_for_funding(
    invoice: &mut Invoice,
    discount_price: u64,
    ctx: &TxContext
  ) {
    assert!(invoice.issuer == ctx.sender(), E_NOT_ISSUER);
    assert!(invoice.status == STATUS_OPEN, E_INVALID_STATUS);
    assert!(discount_price > 0, E_INVALID_PRICE);
    assert!(discount_price <= invoice.amount, E_INVALID_PRICE);
    invoice.discount_price = discount_price;
  }

  /// Optional compliance control for demo: set allowlist/denylist per invoice.
  public entry fun set_compliance_lists(
    invoice: &mut Invoice,
    allowlist: vector<address>,
    denylist: vector<address>,
    ctx: &TxContext
  ) {
    assert!(invoice.issuer == ctx.sender(), E_NOT_ISSUER);
    assert!(invoice.status == STATUS_OPEN, E_INVALID_STATUS);
    invoice.allowlist = allowlist;
    invoice.denylist = denylist;
  }

  /// cancel_invoice()
  /// Soft-delete on-chain for shared invoices.
  public entry fun cancel_invoice(
    registry: &mut InvoiceRegistry,
    invoice: &mut Invoice,
    ctx: &TxContext
  ) {
    assert!(invoice.issuer == ctx.sender(), E_NOT_ISSUER);
    assert!(invoice.status == STATUS_OPEN, E_INVALID_STATUS);
    assert!(invoice.registry_id == object::id_address(registry), E_INVALID_REGISTRY);
    assert!(
      dynamic_field::exists_<vector<u8>>(&registry.id, copy invoice.invoice_hash),
      E_INVALID_REGISTRY
    );
    let removed_invoice_id = dynamic_field::remove<vector<u8>, address>(
      &mut registry.id,
      copy invoice.invoice_hash,
    );
    assert!(removed_invoice_id == object::id_address(invoice), E_INVALID_REGISTRY);
    invoice.status = STATUS_CANCELLED;
    invoice.discount_price = 0;
  }

  /// fund_invoice()
  public entry fun fund_invoice(
    invoice: &mut Invoice,
    payment: iota::coin::Coin<iota::iota::IOTA>,
    clock: &iota::clock::Clock,
    ctx: &mut TxContext
  ) {
    assert!(invoice.status == STATUS_OPEN, E_INVALID_STATUS);
    assert!(invoice.discount_price > 0, E_INVALID_PRICE);
    assert!(is_allowed(invoice, ctx.sender()), E_NOT_ALLOWED);
    assert!(invoice.issuer != ctx.sender(), E_SELF_FUNDING);
    assert!(
      iota::coin::value(&payment) == invoice.discount_price,
      E_INVALID_PAYMENT
    );
    let mut payment_mut = payment;
    let fee_amount = (invoice.discount_price * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
    if (fee_amount > 0) {
      let fee_coin = iota::coin::split(&mut payment_mut, fee_amount, ctx);
      transfer::public_transfer(fee_coin, TREASURY_ADDRESS);
    };

    transfer::public_transfer(payment_mut, invoice.issuer);
    invoice.holder = ctx.sender();
    let now_ms = iota::clock::timestamp_ms(clock);
    invoice.funded_at_ms = now_ms;
    if (invoice.simulation_mode) {
      invoice.due_date = (now_ms / 1000) + DUE_OFFSET_SEC_SIMULATION;
    };
    invoice.status = STATUS_FUNDED;
  }

  /// repay_invoice()
  public entry fun repay_invoice(
    invoice: &mut Invoice,
    payment: iota::coin::Coin<iota::iota::IOTA>,
    clock: &iota::clock::Clock,
    ctx: &TxContext
  ) {
    assert!(invoice.issuer == ctx.sender(), E_NOT_ISSUER);

    let payment_amount = iota::coin::value(&payment);
    if (invoice.status == STATUS_FUNDED) {
      assert!(payment_amount == invoice.amount, E_INVALID_PAYMENT);
      transfer::public_transfer(payment, invoice.holder);
      invoice.status = STATUS_REPAID;
      return
    };

    if (invoice.status == STATUS_DEFAULTED) {
      assert!(invoice.simulation_mode, E_NOT_SIMULATION);
      let default_fee = default_fee_amount(invoice.amount);
      let required_amount = invoice.amount + default_fee;
      assert!(payment_amount == required_amount, E_INVALID_PAYMENT);
      transfer::public_transfer(payment, invoice.holder);
      invoice.status = STATUS_RECOVERED;
      invoice.recovered_at_ms = iota::clock::timestamp_ms(clock);
      iota::event::emit(InvoiceRecovered {
        invoice_id: object::id_address(invoice),
        issuer: invoice.issuer,
        holder: invoice.holder,
        repaid_amount: required_amount,
        default_fee,
        recovered_at_ms: invoice.recovered_at_ms
      });
      return
    };

    abort E_INVALID_STATUS
  }

  /// mark_defaulted()
  /// Buyer can mark default once simulation due date has passed.
  public entry fun mark_defaulted(
    invoice: &mut Invoice,
    clock: &iota::clock::Clock,
    ctx: &TxContext
  ) {
    assert!(invoice.simulation_mode, E_NOT_SIMULATION);
    assert!(invoice.holder == ctx.sender(), E_NOT_HOLDER);
    assert!(invoice.status == STATUS_FUNDED, E_INVALID_STATUS);

    let now_ms = iota::clock::timestamp_ms(clock);
    let now_sec = now_ms / 1000;
    assert!(now_sec > invoice.due_date, E_NOT_DUE_FOR_DEFAULT);

    invoice.status = STATUS_DEFAULTED;
    invoice.was_defaulted = true;
    invoice.defaulted_at_ms = now_ms;
    // Auto-feedback for default event: initial score 1/5, set by holder.
    invoice.rating_score = 1;
    invoice.rated_by = ctx.sender();
    invoice.auto_default_rating = true;
    iota::event::emit(InvoiceDefaulted {
      invoice_id: object::id_address(invoice),
      issuer: invoice.issuer,
      holder: invoice.holder,
      due_date: invoice.due_date,
      defaulted_at_ms: now_ms
    });
  }

  /// Default fee (simulation mode only), 100% transferred to holder on recovery.
  fun default_fee_amount(amount: u64): u64 {
    (amount * DEFAULT_FEE_BPS) / BPS_DENOMINATOR
  }

  fun create_invoice_internal(
    registry: &mut InvoiceRegistry,
    notarization_ref: &notarization::Notarization<vector<u8>>,
    invoice_hash: vector<u8>,
    amount: u64,
    due_date: u64,
    simulation_mode: bool,
    ctx: &mut TxContext
  ) {
    assert!(amount > 0, E_INVALID_AMOUNT);
    assert!(due_date > 0, E_INVALID_AMOUNT);
    assert!(vector::length(&invoice_hash) == PDF_SHA256_BYTE_LEN, E_INVALID_NOTARIZATION);
    assert_notarization_matches(notarization_ref, &invoice_hash);
    assert!(!dynamic_field::exists_<vector<u8>>(&registry.id, copy invoice_hash), E_DUPLICATE_HASH);
    let notarization_id = object::id_address(notarization_ref);

    let registry_id = object::id_address(registry);
    let invoice = Invoice {
      id: object::new(ctx),
      registry_id,
      issuer: ctx.sender(),
      holder: @0x0,
      notarization_id,
      invoice_hash,
      amount,
      due_date,
      discount_price: 0,
      rating_score: 0,
      rated_by: @0x0,
      auto_default_rating: false,
      allowlist: vector[],
      denylist: vector[],
      status: STATUS_OPEN,
      simulation_mode,
      was_defaulted: false,
      funded_at_ms: 0,
      defaulted_at_ms: 0,
      recovered_at_ms: 0
    };

    let invoice_id = object::id_address(&invoice);
    dynamic_field::add(&mut registry.id, copy invoice.invoice_hash, invoice_id);
    iota::event::emit(InvoiceCreated {
      invoice_id,
      registry_id,
      issuer: invoice.issuer,
      notarization_id,
      invoice_hash: copy invoice.invoice_hash,
      amount,
      due_date,
      simulation_mode
    });
    transfer::share_object(invoice);
  }

  fun assert_notarization_matches(
    notarization_ref: &notarization::Notarization<vector<u8>>,
    invoice_hash: &vector<u8>,
  ) {
    let notarization_method = notarization::notarization_method(notarization_ref);
    assert!(method::is_locked(&notarization_method), E_INVALID_NOTARIZATION_METHOD);
    assert!(notarization::state_data(notarization_ref) == invoice_hash, E_NOTARIZATION_HASH_MISMATCH);
    assert!(
      has_expected_notarization_state_metadata(notarization::state_metadata(notarization_ref)),
      E_INVALID_NOTARIZATION_SCHEMA
    );
  }

  fun has_expected_notarization_state_metadata(metadata: &Option<String>): bool {
    if (!option::is_some(metadata)) {
      return false
    };

    let expected = string::utf8(b"application/vnd.invoicevault.pdf-hash+sha256;v=1");
    string::as_bytes(option::borrow(metadata)) == string::as_bytes(&expected)
  }

  /// rate_invoice(score)
  /// Buyer -> issuer rating after successful repayment.
  /// If invoice was auto-rated on default (1/5), buyer can override once after recovery.
  public entry fun rate_invoice(invoice: &mut Invoice, score: u8, ctx: &TxContext) {
    assert!(invoice.holder == ctx.sender(), E_NOT_HOLDER);
    assert!(
      invoice.status == STATUS_REPAID || invoice.status == STATUS_RECOVERED,
      E_NOT_REPAID
    );
    if (invoice.rating_score != 0) {
      assert!(
        invoice.status == STATUS_RECOVERED && invoice.auto_default_rating,
        E_ALREADY_RATED
      );
    };
    assert!(score >= 1 && score <= 5, E_INVALID_RATING);
    invoice.rating_score = score;
    invoice.rated_by = ctx.sender();
    invoice.auto_default_rating = false;
  }

  fun is_allowed(invoice: &Invoice, buyer: address): bool {
    let blocked = vector::contains(&invoice.denylist, &buyer);
    if (blocked) {
      return false
    };

    let allowlist_len = vector::length(&invoice.allowlist);
    if (allowlist_len == 0) {
      return true
    };

    vector::contains(&invoice.allowlist, &buyer)
  }

  // === Tests ===
  #[test_only] use iota::clock;
  #[test_only] use iota::test_scenario as ts;
  #[test_only] use iota_notarization::{dynamic_notarization, locked_notarization, timelock};

  #[test_only] const ALICE: address = @0xA;
  #[test_only] const BOB: address = @0xB;

  #[test_only]
  fun test_registry(ctx: &mut TxContext): InvoiceRegistry {
    InvoiceRegistry { id: object::new(ctx) }
  }

  #[test_only]
  fun test_invoice(
    issuer: address,
    holder: address,
    status: u8,
    simulation_mode: bool,
    ctx: &mut TxContext
  ): Invoice {
    Invoice {
      id: object::new(ctx),
      registry_id: @0x1,
      issuer,
      holder,
      notarization_id: @0x1,
      invoice_hash: vector[1, 2, 3],
      amount: 100,
      due_date: 1,
      discount_price: 90,
      rating_score: 0,
      rated_by: @0x0,
      auto_default_rating: false,
      allowlist: vector[],
      denylist: vector[],
      status,
      simulation_mode,
      was_defaulted: false,
      funded_at_ms: 0,
      defaulted_at_ms: 0,
      recovered_at_ms: 0
    }
  }

  #[test_only]
  fun destroy_invoice(invoice: Invoice) {
    let Invoice {
      id,
      registry_id: _,
      issuer: _,
      holder: _,
      notarization_id: _,
      invoice_hash: _,
      amount: _,
      due_date: _,
      discount_price: _,
      rating_score: _,
      rated_by: _,
      auto_default_rating: _,
      allowlist: _,
      denylist: _,
      status: _,
      simulation_mode: _,
      was_defaulted: _,
      funded_at_ms: _,
      defaulted_at_ms: _,
      recovered_at_ms: _,
    } = invoice;
    id.delete();
  }

  #[test_only]
  fun destroy_registry(registry: InvoiceRegistry) {
    let InvoiceRegistry { id } = registry;
    id.delete();
  }

  #[test_only]
  fun destroy_notarization(
    notarization_ref: notarization::Notarization<vector<u8>>,
    clock_ref: &clock::Clock,
  ) {
    notarization::destroy(notarization_ref, clock_ref);
  }

  #[test_only]
  fun test_hash(fill: u8): vector<u8> {
    let mut hash = vector[];
    let mut index = 0;
    while (index < PDF_SHA256_BYTE_LEN) {
      vector::push_back(&mut hash, fill);
      index = index + 1;
    };
    hash
  }

  #[test_only]
  fun test_locked_notarization(
    hash: vector<u8>,
    clock_ref: &clock::Clock,
    ctx: &mut TxContext,
  ): notarization::Notarization<vector<u8>> {
    let state = notarization::new_state_from_bytes(
      hash,
      option::some(string::utf8(b"application/vnd.invoicevault.pdf-hash+sha256;v=1")),
    );

    locked_notarization::new(
      state,
      option::some(string::utf8(b"InvoiceVault PDF SHA-256 anchor")),
      option::some(string::utf8(b"{\"schema\":\"invoicevault.notarization.metadata.v1\",\"documentType\":\"invoice_pdf\",\"mimeType\":\"application/pdf\",\"sizeBytes\":3}")),
      timelock::none(),
      clock_ref,
      ctx,
    )
  }

  #[test_only]
  fun test_dynamic_notarization(
    hash: vector<u8>,
    clock_ref: &clock::Clock,
    ctx: &mut TxContext,
  ): notarization::Notarization<vector<u8>> {
    let state = notarization::new_state_from_bytes(
      hash,
      option::some(string::utf8(b"application/vnd.invoicevault.pdf-hash+sha256;v=1")),
    );

    dynamic_notarization::new(
      state,
      option::some(string::utf8(b"InvoiceVault PDF SHA-256 anchor")),
      option::none(),
      timelock::none(),
      clock_ref,
      ctx,
    )
  }

  #[test_only]
  fun add_registered_hash_for_testing(
    registry: &mut InvoiceRegistry,
    invoice_hash: vector<u8>,
    invoice_id: address,
  ) {
    dynamic_field::add(&mut registry.id, invoice_hash, invoice_id);
  }

  #[test_only]
  fun remove_registered_hash_for_testing(
    registry: &mut InvoiceRegistry,
    invoice_hash: vector<u8>,
  ): address {
    dynamic_field::remove(&mut registry.id, invoice_hash)
  }

  #[test_only]
  fun notarization_validation_error(
    notarization_ref: &notarization::Notarization<vector<u8>>,
    invoice_hash: vector<u8>,
  ): u64 {
    let notarization_method = notarization::notarization_method(notarization_ref);
    if (!method::is_locked(&notarization_method)) {
      return E_INVALID_NOTARIZATION_METHOD
    };
    if (notarization::state_data(notarization_ref) != &invoice_hash) {
      return E_NOTARIZATION_HASH_MISMATCH
    };
    if (!has_expected_notarization_state_metadata(notarization::state_metadata(notarization_ref))) {
      return E_INVALID_NOTARIZATION_SCHEMA
    };
    0
  }

  #[test_only]
  fun create_invoice_validation_error(
    registry: &InvoiceRegistry,
    notarization_ref: &notarization::Notarization<vector<u8>>,
    invoice_hash: vector<u8>,
    amount: u64,
    due_date: u64,
  ): u64 {
    if (amount == 0 || due_date == 0) {
      return E_INVALID_AMOUNT
    };
    if (vector::length(&invoice_hash) != PDF_SHA256_BYTE_LEN) {
      return E_INVALID_NOTARIZATION
    };

    let notarization_error = notarization_validation_error(notarization_ref, copy invoice_hash);
    if (notarization_error != 0) {
      return notarization_error
    };
    if (dynamic_field::exists_<vector<u8>>(&registry.id, invoice_hash)) {
      return E_DUPLICATE_HASH
    };
    0
  }

  #[test_only]
  fun funding_validation_error(invoice: &Invoice, buyer: address, payment_amount: u64): u64 {
    if (invoice.status != STATUS_OPEN) {
      return E_INVALID_STATUS
    };
    if (invoice.discount_price == 0 || invoice.discount_price > invoice.amount) {
      return E_INVALID_PRICE
    };
    if (!is_allowed(invoice, buyer)) {
      return E_NOT_ALLOWED
    };
    if (invoice.issuer == buyer) {
      return E_SELF_FUNDING
    };
    if (payment_amount != invoice.discount_price) {
      return E_INVALID_PAYMENT
    };
    0
  }

  #[test]
  fun duplicate_hash_rejected() {
    let mut ts = ts::begin(ALICE);
    let mut registry = test_registry(ts.ctx());
    let hash = test_hash(7);
    let clock_ref = clock::create_for_testing(ts.ctx());
    let notarization_ref = test_locked_notarization(copy hash, &clock_ref, ts.ctx());
    let existing_invoice_id = @0xC;

    add_registered_hash_for_testing(&mut registry, copy hash, existing_invoice_id);

    assert!(
      create_invoice_validation_error(&registry, &notarization_ref, copy hash, 100, 10) == E_DUPLICATE_HASH,
      E_DUPLICATE_HASH
    );

    let removed_invoice_id = remove_registered_hash_for_testing(&mut registry, hash);
    assert!(removed_invoice_id == existing_invoice_id, E_DUPLICATE_HASH);

    destroy_notarization(notarization_ref, &clock_ref);
    clock::destroy_for_testing(clock_ref);
    destroy_registry(registry);
    ts::end(ts);
  }

  #[test]
  fun cancelled_hash_can_be_reused() {
    let mut ts = ts::begin(ALICE);
    let mut registry = test_registry(ts.ctx());
    let registry_id = object::id_address(&registry);
    let hash = test_hash(8);
    let mut invoice = Invoice {
      id: object::new(ts.ctx()),
      registry_id,
      issuer: ALICE,
      holder: @0x0,
      notarization_id: @0x1,
      invoice_hash: copy hash,
      amount: 100,
      due_date: 1,
      discount_price: 90,
      rating_score: 0,
      rated_by: @0x0,
      auto_default_rating: false,
      allowlist: vector[],
      denylist: vector[],
      status: STATUS_OPEN,
      simulation_mode: false,
      was_defaulted: false,
      funded_at_ms: 0,
      defaulted_at_ms: 0,
      recovered_at_ms: 0
    };
    let invoice_id = object::id_address(&invoice);
    let clock_ref = clock::create_for_testing(ts.ctx());
    let notarization_ref = test_locked_notarization(copy hash, &clock_ref, ts.ctx());

    dynamic_field::add(&mut registry.id, copy hash, invoice_id);
    cancel_invoice(&mut registry, &mut invoice, ts.ctx());

    assert!(invoice.status == STATUS_CANCELLED, E_INVALID_STATUS);
    assert!(
      !dynamic_field::exists_<vector<u8>>(&registry.id, copy hash),
      E_DUPLICATE_HASH
    );
    assert!(
      create_invoice_validation_error(&registry, &notarization_ref, copy hash, 100, 10) == 0,
      E_DUPLICATE_HASH
    );

    destroy_notarization(notarization_ref, &clock_ref);
    clock::destroy_for_testing(clock_ref);
    destroy_invoice(invoice);
    destroy_registry(registry);
    ts::end(ts);
  }

  #[test]
  fun self_funding_rejected() {
    let mut ts = ts::begin(ALICE);
    let mut invoice = test_invoice(ALICE, @0x0, STATUS_OPEN, false, ts.ctx());
    invoice.discount_price = 90;

    assert!(funding_validation_error(&invoice, ALICE, 90) == E_SELF_FUNDING, E_SELF_FUNDING);

    destroy_invoice(invoice);
    ts::end(ts);
  }

  #[test]
  fun default_marks_auto_rating() {
    let mut ts = ts::begin(BOB);
    let mut invoice = test_invoice(ALICE, BOB, STATUS_FUNDED, true, ts.ctx());
    let mut clock = clock::create_for_testing(ts.ctx());

    clock::set_for_testing(&mut clock, 2_000);
    mark_defaulted(&mut invoice, &clock, ts.ctx());

    assert!(invoice.status == STATUS_DEFAULTED, E_INVALID_STATUS);
    assert!(invoice.rating_score == 1, E_INVALID_RATING);
    assert!(invoice.auto_default_rating, E_INVALID_RATING);
    assert!(invoice.rated_by == BOB, E_NOT_HOLDER);

    clock::destroy_for_testing(clock);
    destroy_invoice(invoice);
    ts::end(ts);
  }

  #[test]
  fun recovered_invoice_can_override_auto_rating() {
    let mut ts = ts::begin(BOB);
    let mut invoice = test_invoice(ALICE, BOB, STATUS_RECOVERED, true, ts.ctx());

    invoice.rating_score = 1;
    invoice.rated_by = BOB;
    invoice.auto_default_rating = true;

    rate_invoice(&mut invoice, 4, ts.ctx());

    assert!(invoice.rating_score == 4, E_INVALID_RATING);
    assert!(invoice.rated_by == BOB, E_NOT_HOLDER);
    assert!(!invoice.auto_default_rating, E_INVALID_RATING);

    destroy_invoice(invoice);
    ts::end(ts);
  }

  #[test]
  fun notarization_payload_mismatch_rejected() {
    let mut ts = ts::begin(ALICE);
    let registry = test_registry(ts.ctx());
    let clock_ref = clock::create_for_testing(ts.ctx());
    let notarization_ref = test_locked_notarization(test_hash(1), &clock_ref, ts.ctx());

    assert!(
      create_invoice_validation_error(&registry, &notarization_ref, test_hash(2), 100, 10) == E_NOTARIZATION_HASH_MISMATCH,
      E_NOTARIZATION_HASH_MISMATCH
    );

    destroy_notarization(notarization_ref, &clock_ref);
    clock::destroy_for_testing(clock_ref);
    destroy_registry(registry);
    ts::end(ts);
  }

  #[test]
  fun dynamic_notarization_rejected() {
    let mut ts = ts::begin(ALICE);
    let registry = test_registry(ts.ctx());
    let hash = test_hash(1);
    let clock_ref = clock::create_for_testing(ts.ctx());
    let notarization_ref = test_dynamic_notarization(copy hash, &clock_ref, ts.ctx());

    assert!(
      create_invoice_validation_error(&registry, &notarization_ref, hash, 100, 10) == E_INVALID_NOTARIZATION_METHOD,
      E_INVALID_NOTARIZATION_METHOD
    );

    destroy_notarization(notarization_ref, &clock_ref);
    clock::destroy_for_testing(clock_ref);
    destroy_registry(registry);
    ts::end(ts);
  }
}
