use std::{
    alloc::{Layout, alloc as rust_alloc, dealloc},
    cell::RefCell,
    collections::BTreeMap,
    slice, str,
};

pub const ABI_VERSION: u32 = 1;

thread_local! {
    static RESULTS: RefCell<BTreeMap<u32, Vec<u8>>> = const { RefCell::new(BTreeMap::new()) };
    static NEXT_RESULT: RefCell<u32> = const { RefCell::new(1) };
}

#[unsafe(no_mangle)]
pub extern "C" fn abi_version() -> u32 {
    ABI_VERSION
}

#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    if len == 0 {
        return std::ptr::null_mut();
    }
    let Ok(layout) = Layout::array::<u8>(len) else {
        return std::ptr::null_mut();
    };
    unsafe { rust_alloc(layout) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn free(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 {
        return;
    }
    if let Ok(layout) = Layout::array::<u8>(len) {
        unsafe {
            dealloc(ptr, layout);
        }
    }
}

pub unsafe fn read_utf8<'a>(ptr: *const u8, len: usize) -> Option<&'a str> {
    if len == 0 {
        return Some("");
    }
    if ptr.is_null() {
        return None;
    }
    let bytes = unsafe { slice::from_raw_parts(ptr, len) };
    str::from_utf8(bytes).ok()
}

pub fn store_result(bytes: Vec<u8>) -> u32 {
    RESULTS.with(|results| {
        NEXT_RESULT.with(|next| {
            let mut next = next.borrow_mut();
            let handle = *next;
            *next = next.saturating_add(1).max(1);
            results.borrow_mut().insert(handle, bytes);
            handle
        })
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn result_ptr(handle: u32) -> *const u8 {
    RESULTS.with(|results| {
        results
            .borrow()
            .get(&handle)
            .map_or(std::ptr::null(), |bytes| bytes.as_ptr())
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn result_len(handle: u32) -> usize {
    RESULTS.with(|results| results.borrow().get(&handle).map_or(0, Vec::len))
}

#[unsafe(no_mangle)]
pub extern "C" fn free_result(handle: u32) {
    RESULTS.with(|results| {
        results.borrow_mut().remove(&handle);
    });
}
