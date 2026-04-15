---
title: "Golang源码系列--sort"
author: "Joker"
pubDatetime: 2022-02-11T00:52:13+08:00
draft: false
tags:
  - "Golang源码"
description: "Golang sort的实现源码解析"
---

### 概述
正如sort的含义，go的sort包提供排序的能力，其内部实现了堆排、快排、插入排序、希尔排序和归并排序，而且针对某些排序比如快排和归并排序进行了优化，做到了性能的极致

### 接口
```go
// An implementation of Interface can be sorted by the routines in this package.
// The methods refer to elements of the underlying collection by integer index.
// 所有实现了该interface的都可以使用sort包进行排序
type Interface interface {
	// Len is the number of elements in the collection.
	// 待排序元素个数
	Len() int

	// Less reports whether the element with index i
	// must sort before the element with index j.
	//
	// If both Less(i, j) and Less(j, i) are false,
	// then the elements at index i and j are considered equal.
	// Sort may place equal elements in any order in the final result,
	// while Stable preserves the original input order of equal elements.
	//
	// Less must describe a transitive ordering:
	//  - if both Less(i, j) and Less(j, k) are true, then Less(i, k) must be true as well.
	//  - if both Less(i, j) and Less(j, k) are false, then Less(i, k) must be false as well.
	//
	// Note that floating-point comparison (the < operator on float32 or float64 values)
	// is not a transitive ordering when not-a-number (NaN) values are involved.
	// See Float64Slice.Less for a correct implementation for floating-point values.
	// 比较第i个元素和第j个元素，具体如何比较自己按需实现，返回一个bool类型变量
	// 这里提一嘴，你可以通过实现Less来控制从大到小排序和从小到大排序
	Less(i, j int) bool

	// Swap swaps the elements with indexes i and j.
	// 交换第i和第j个元素
	Swap(i, j int)
}
```
### 插入排序
```go
// insertionSort sorts data[a:b] using insertion sort.
// 中规中矩的插入排序实现
// 时间复杂度n^2
func insertionSort(data Interface, a, b int) {
	// 从第a+1遍历到第b-1个元素
	for i := a + 1; i < b; i++ {
		// 依次插入元素并进行向前比较、调换
		for j := i; j > a && data.Less(j, j-1); j-- {
			data.Swap(j, j-1)
		}
	}
}
```
### 堆排序
```go
// siftDown implements the heap property on data[lo:hi].
// first is an offset into the array where the root of the heap lies.
// 向下追溯的过程，这个之前在讲解container包的文章中已经说过了，这里不再赘述
func siftDown(data Interface, lo, hi, first int) {
	root := lo
	for {
		child := 2*root + 1
		if child >= hi {
			break
		}
		if child+1 < hi && data.Less(first+child, first+child+1) {
			child++
		}
		if !data.Less(first+root, first+child) {
			return
		}
		data.Swap(first+root, first+child)
		root = child
	}
}

// 中规中矩的堆排
func heapSort(data Interface, a, b int) {
	first := a
	lo := 0
	hi := b - a

	// 找到最后一个叶子节点，然后向前遍历所有叶子节点到根节点
	// 从下往上构造最大/小堆
	// Build heap with greatest element at top.
	for i := (hi - 1) / 2; i >= 0; i-- {
		siftDown(data, i, hi, first)
	}

	// Pop elements, largest first, into end of data.
	// 构造完最大/小堆之后，就开始将堆顶元素与最后一个元素互换
	// 这样最大/小的元素就到最后了，然后继续向下追溯找下一个正确的堆顶元素
	// 重复该动作，最后就是递增/减有序的了
	for i := hi - 1; i >= 0; i-- {
		data.Swap(first, first+i)
		siftDown(data, lo, i, first)
	}
}
```
### 快排
```go
// Quicksort, loosely following Bentley and McIlroy,
// ``Engineering a Sort Function,'' SP&E November 1993.

// medianOfThree moves the median of the three values data[m0], data[m1], data[m2] into data[m1].
// 该方法就是找三数中值，即保证最终m0 <= m1 <= m2，m1是中间值
func medianOfThree(data Interface, m1, m0, m2 int) {
	// sort 3 elements
	if data.Less(m1, m0) {
		data.Swap(m1, m0)
	}
	// data[m0] <= data[m1]
	if data.Less(m2, m1) {
		data.Swap(m2, m1)
		// data[m0] <= data[m2] && data[m1] < data[m2]
		if data.Less(m1, m0) {
			data.Swap(m1, m0)
		}
	}
	// now data[m0] <= data[m1] <= data[m2]
}

// Sort sorts data.
// It makes one call to data.Len to determine n and O(n*log(n)) calls to
// data.Less and data.Swap. The sort is not guaranteed to be stable.
// 对外提供的非稳定排序的方法
func Sort(data Interface) {
	// 获取待排序元素个数
	n := data.Len()
	// 排序
	// 注意这里会通过maxDepth计算出数据量级
	// quickSort会根据数据量级来选择合适的排序算法
	quickSort(data, 0, n, maxDepth(n))
}

// maxDepth returns a threshold at which quicksort should switch
// to heapsort. It returns 2*ceil(lg(n+1)).
// 计算结构就是 2*ceil(lg(n+1))
// 即使用二叉树来装载数据，对应深度的2倍就是计算出的量级
// 通过这个来控制递归的深度
// 至于为什么是2*ceil(lg(n+1))，这个暂时不清楚，可能是实验的结果吧
func maxDepth(n int) int {
	var depth int
	for i := n; i > 0; i >>= 1 {
		depth++
	}
	return depth * 2
}

// 看函数名是快排，但实际实现并不是单纯的快排算法
func quickSort(data Interface, a, b, maxDepth int) {
	// 如果待排元素数量 <=12 就会使用后面的希尔+插入排序
	for b-a > 12 { // Use ShellSort for slices <= 12 elements
		// 如果超过了递归深度，则退化为堆排序
		// 这里没有直接用堆排序来实现主要还是因为快排比堆排综合性能高一些(两者的平均复杂度都是O(n*logn))
		// 主要表现在两点，一个是快排的数据交换少点，另外一个是快排的数据访问遵从局部性原则，而堆排则是跳跃访问的，对cpu缓存不友好
		if maxDepth == 0 {
			heapSort(data, a, b)
			return
		}
		// 每次递归数减一
		maxDepth--
		// doPivot返回两个位置，一个是低位一个是高位
		// 这里有些人可能有些困惑，因为传统的快排算法只需要算出中间位置即可
		// 原因能是因为对传统快排算法进行了优化，具体怎么优化，doPivot里面会说
		// 这里你就认为mlo及其左边的元素都是 <= 某个值的
		// mhi及其右边的元素都是 > 某个值的
		mlo, mhi := doPivot(data, a, b)
		// Avoiding recursion on the larger subproblem guarantees
		// a stack depth of at most lg(b-a).
		// 通过上面的操作，待排序的数据分两段，即a - mlo 和 mhi - b
		// 选取元素更少的那段进行递归
		// 元素更多的继续循环切分成小段
		// 这样可以减少递归深度
		if mlo-a < b-mhi {
			quickSort(data, a, mlo, maxDepth)
			a = mhi // i.e., quickSort(data, mhi, b)
		} else {
			quickSort(data, mhi, b, maxDepth)
			b = mlo // i.e., quickSort(data, a, mlo)
		}
	}
	// 如果待排元素数量 <=12 && >= 2
	// 直接选用希尔+插入排序
	if b-a > 1 {
		// Do ShellSort pass with gap 6
		// It could be written in this simplified form cause b-a <= 12
		// 希尔本省就是插入的优化，核心思路就是通过局部有序来达到整体大致有序，从而减少插入过程中的swap次数
		// 这里因为数据量很少，所以只对间隔为6的数据进行了两两比较替换
		for i := a + 6; i < b; i++ {
			if data.Less(i, i-6) {
				data.Swap(i, i-6)
			}
		}
		// 最后插入排序
		insertionSort(data, a, b)
	}
}


// 终于到了核心部分了
func doPivot(data Interface, lo, hi int) (midlo, midhi int) {
	// lo+hi/2
	// 位操作写法学起来
	m := int(uint(lo+hi) >> 1) // Written like this to avoid integer overflow.
	// 这是第一个优化点
	// 常规的快排一般选取第一个/最后一个元素作为哨兵
	// 这种方式在某些有序的情况下会导致切分后的两段长度非常不均匀，导致时间复杂度急剧下降到O(n^2)
	// Tukey提出一种解决思路，就是以中位数的中位数的方式来选取哨兵，具体可见https://www.johndcook.com/blog/2009/06/23/tukey-median-ninther/
	// 其中也给了个例子，比如数据集3, 1, 4, 4, 5, 9, 9, 8, 2
	// yA = median( 3, 1, 4 ) = 3
	// yB = median( 4, 5, 9 ) = 5
	// yC = median( 9, 8, 2 ) = 8
	// 最后再求(3, 5, 8)的中位数得到5，选取5作为哨兵
	// 具体能提升多少效率以及为什么能提升，这里不赘述了，自己看论文去
	// 言归正传，当元素数量 > 40的时候，使用3+3+3的方式计算最后的中位数
	if hi-lo > 40 {
		// Tukey's ``Ninther,'' median of three medians of three.
		// 计算跨度，为啥除以8呢，因为切成8份，就能平均分出9个位点，刚好就是3+3+3
		// 不信你假设hi-ho=80，80/8 = 10，切成8份
		// lo lo+s lo+2*s m m-s m+s hi-1 hi-1-s hi-1-2*s刚好对应两个边界点和7个中间分割点
		s := (hi - lo) / 8
		// lo是中位数
		medianOfThree(data, lo, lo+s, lo+2*s)
		// m是中位数
		medianOfThree(data, m, m-s, m+s)
		// hi-1是中位数
		medianOfThree(data, hi-1, hi-1-s, hi-1-2*s)
	}
	// 将三个中位数再算一次中位数
	// 当元素数量 <= 40的时候，直接计算(lo, m, hi-1)的中位数
	// 这里提下，medianOfThree的实现方式会对数据进行调换，也就是说最终中位数就是lo，lo就是哨兵
	medianOfThree(data, lo, m, hi-1)

	// Invariants are:
	//	data[lo] = pivot (set up by ChoosePivot)
	//	data[lo < i < a] < pivot
	//	data[a <= i < b] <= pivot
	//	data[b <= i < c] unexamined
	//	data[c <= i < hi-1] > pivot
	//	data[hi-1] >= pivot
	// 哨兵pivot = lo
	pivot := lo
	// a是第二个元素(以lo为基准)，c是最后一个元素(这里hi可以去追溯一下，最开始传进来的就是元素的数量即长度，索引下标减1)
	// 这么一顿操作之后，我们可以得出以下结论
	// 第hi-1个元素即data[hi-1](后续都这么表示)肯定是 >= pivot的
	// 因为第二轮取中位数data[hi-1]就是最大的
	a, c := lo+1, hi-1

	// 从a遍历到c，直到第一个 >=pivot的元素
	for ; a < c && data.Less(a, pivot); a++ {
	}
	// 将这个位置记录下来
	// 注意，这个位置很重要，后面第二次优化会用到
	// 也就是说(lo,a)(注意这是个开区间)之间的数据都是 < pivot的
	b := a
	for {
		// 这里就正式两头遍历对比哨兵并进行替换了
		// 注意!data.Less(pivot, b)代表所有 <=pivot的元素都在b的左边，注意=
		for ; b < c && !data.Less(pivot, b); b++ { // data[b] <= pivot
		}
		// 这里为啥从c-1开始呢，因为上面说了data[hi-1]肯定是 > pivot的
		for ; b < c && data.Less(pivot, c-1); c-- { // data[c-1] > pivot
		}
		// 循环临界条件
		// 一旦b和c碰上了肯定就结束了
		if b >= c {
			break
		}
		// data[b] > pivot; data[c-1] <= pivot
		// 交换
		data.Swap(b, c-1)
		// 继续向后和向前
		b++
		c--
	}
	// 执行到这里，我们又可以得出以下结论
	// b要么=c，要么>c
	// data[c, hi-1) > pivot 为啥c是闭区间，虽然是拿c-1去比较，但是最后c--，所以c-1+1=c

	// If hi-c<3 then there are duplicates (by property of median of nine).
	// Let's be a bit more conservative, and set border to 5.
	// 当当当当，到了第二个优化的位置了
	// 先看看某个场景，假设待排序结合中有很多的元素=pivot
	// 正常我们希望所有跟pivot相等的元素都集中到一个点，然后再对两边的 <pivot和>pivot段进行排序
	// 然而事实就是传统的快排算法并没有做到这点，所有跟pivot相等的元素都会被随机的分配到左边或者右边
	// 所以第二个优化就是要讲所有与pivot相等的元素都集中到pivot周围，然后计算出左右区间的位置，即要返回的mlo和mhi
	// 言归正传，上面说过 data[c, hi-1) > pivot
	// protect就是>pivot的数量，如果这个数 < 5，就可以认为=pivot的元素比较多
	// 至于什么叫多，为啥是5，我也不太清楚，这里只说思路
	protect := hi-c < 5
	// 如果protect >= 5
	// 但是> pivot的元素数量还不及总数量的1/4，我们还需要抽样来进一步确认
	if !protect && hi-c < (hi-lo)/4 {
		// Lets test some points for equality to pivot
		dups := 0
		// 抽样data[hi-1]
		// 判断是否=pivot
		if !data.Less(pivot, hi-1) { // data[hi-1] = pivot
			// 调换，还记得吧 data[c, hi-1) > pivot
			data.Swap(c, hi-1)
			// c自增，即往右边挪
			c++
			// 计数加1
			dups++
		}
		// 抽样data[b-1]，因为上面最后b++了
		// 判断是否=pivot
		if !data.Less(b-1, pivot) { // data[b-1] = pivot
			// b往左边挪
			b--
			dups++
		}
		// m-lo = (hi-lo)/2 > 6
		// b-lo > (hi-lo)*3/4-1 > 8
		// ==> m < b ==> data[m] <= pivot
		// 抽样data[m]，通过上线计算可知m在b的左边
		if !data.Less(m, pivot) { // data[m] = pivot
			// 所以交换b和m
			data.Swap(m, b-1)
			// b往左挪
			b--
			dups++
		}
		// if at least 2 points are equal to pivot, assume skewed distribution
		// 如果有两个抽样点=pivot，就可以认为=pivot的元素比较多
		protect = dups > 1
	}
	// 如果判定需要优化
	if protect {
		// Protect against a lot of duplicates
		// Add invariant:
		// 到这里经过上面的b左挪，c右挪可以知道如下
		// data[a <= i < b] unexamined
		// data[b <= i < c] = pivot (主要看这个)
		// 也就是说[b,c)区间都是 =pivot的元素
		// 接下来就判断(a,b)区间就行了，这里终于发现了a的作用了，就是为了尽量减少这里的区间长度
		for {
			// 做右往左找<pivot的元素
			for ; a < b && !data.Less(b-1, pivot); b-- { // data[b] == pivot
			}
			// 从左往右找=pivot的元素
			for ; a < b && data.Less(a, pivot); a++ { // data[a] < pivot
			}
			// 临界条件
			if a >= b {
				break
			}
			// data[a] == pivot; data[b-1] < pivot
			// 替换
			data.Swap(a, b-1)
			a++
			b--
		}
	}
	// Swap pivot into middle
	// 最终将哨兵和b-1替换，这里为啥是b-1呢
	// 看上面data.Swap(a, b-1)后data[b-1]肯定是=pivot的，然后b--那么data[b] = pivot
	// 替换哨兵pivot肯定是要跟离b最近的<pivot的元素替换，所以是b-1咯
	data.Swap(pivot, b-1)
	// 最后返回低位和高位
	return b - 1, c
}
```
### 稳定排序
```go
// Stable用于稳定排序
func Stable(data Interface) {
	stable(data, data.Len())
}

// 主要是用归并排序+插入排序来实现
func stable(data Interface, n int) {
	// 定义块大小，这里是20
	blockSize := 20 // must be > 0
	a, b := 0, blockSize
	// 以20个元素为一组，并对每组使用插入排序达到组内有序
	// 这里分组可以减少递归深度，至于为啥是20个，可能是20个插入排序和归并排序性能差不多吧，实验结果，不必纠结
	for b <= n {
		insertionSort(data, a, b)
		a = b
		b += blockSize
	}
	// 最后一组可能不满20个
	insertionSort(data, a, n)

	// 组分好了，也排好了，就该合并了
	for blockSize < n {
		a, b = 0, 2*blockSize
		// 从左到右两两合并
		for b <= n {
			symMerge(data, a, a+blockSize, b)
			a = b
			b += 2 * blockSize
		}
		// 如果最后两组不够2*blockSize
		if m := a + blockSize; m < n {
			symMerge(data, a, m, n)
		}
		// 每次两两合并之后，blockSize肯定翻倍的
		blockSize *= 2
	}
}

// symMerge merges the two sorted subsequences data[a:m] and data[m:b] using
// the SymMerge algorithm from Pok-Son Kim and Arne Kutzner, "Stable Minimum
// Storage Merging by Symmetric Comparisons", in Susanne Albers and Tomasz
// Radzik, editors, Algorithms - ESA 2004, volume 3221 of Lecture Notes in
// Computer Science, pages 714-723. Springer, 2004.
//
// Let M = m-a and N = b-n. Wolog M < N.
// The recursion depth is bound by ceil(log(N+M)).
// The algorithm needs O(M*log(N/M + 1)) calls to data.Less.
// The algorithm needs O((M+N)*log(M)) calls to data.Swap.
//
// The paper gives O((M+N)*log(M)) as the number of assignments assuming a
// rotation algorithm which uses O(M+N+gcd(M+N)) assignments. The argumentation
// in the paper carries through for Swap operations, especially as the block
// swapping rotate uses only O(M+N) Swaps.
//
// symMerge assumes non-degenerate arguments: a < m && m < b.
// Having the caller check this condition eliminates many leaf recursion calls,
// which improves performance.
// symMerge就是合并的具体实现了
// 具体实现吧是基于论文 Stable Minimum Storage Merging by Symmetric Comparisons
// 这里写的实在不知道咋用语言表达了，所以自己去看论文吧
func symMerge(data Interface, a, m, b int) {
	// Avoid unnecessary recursions of symMerge
	// by direct insertion of data[a] into data[m:b]
	// if data[a:m] only contains one element.
	if m-a == 1 {
		// Use binary search to find the lowest index i
		// such that data[i] >= data[a] for m <= i < b.
		// Exit the search loop with i == b in case no such index exists.
		i := m
		j := b
		for i < j {
			h := int(uint(i+j) >> 1)
			if data.Less(h, a) {
				i = h + 1
			} else {
				j = h
			}
		}
		// Swap values until data[a] reaches the position before i.
		for k := a; k < i-1; k++ {
			data.Swap(k, k+1)
		}
		return
	}

	// Avoid unnecessary recursions of symMerge
	// by direct insertion of data[m] into data[a:m]
	// if data[m:b] only contains one element.
	if b-m == 1 {
		// Use binary search to find the lowest index i
		// such that data[i] > data[m] for a <= i < m.
		// Exit the search loop with i == m in case no such index exists.
		i := a
		j := m
		for i < j {
			h := int(uint(i+j) >> 1)
			if !data.Less(m, h) {
				i = h + 1
			} else {
				j = h
			}
		}
		// Swap values until data[m] reaches the position i.
		for k := m; k > i; k-- {
			data.Swap(k, k-1)
		}
		return
	}

	mid := int(uint(a+b) >> 1)
	n := mid + m
	var start, r int
	if m > mid {
		start = n - b
		r = mid
	} else {
		start = a
		r = m
	}
	p := n - 1

	for start < r {
		c := int(uint(start+r) >> 1)
		if !data.Less(p-c, c) {
			start = c + 1
		} else {
			r = c
		}
	}

	end := n - start
	if start < m && m < end {
		rotate(data, start, m, end)
	}
	if a < start && start < mid {
		symMerge(data, a, start, mid)
	}
	if mid < end && end < b {
		symMerge(data, mid, end, b)
	}
}
```
### 一些常用的函数
```go
// Ints sorts a slice of ints in increasing order.
func Ints(x []int) { Sort(IntSlice(x)) }

// Float64s sorts a slice of float64s in increasing order.
// Not-a-number (NaN) values are ordered before other values.
func Float64s(x []float64) { Sort(Float64Slice(x)) }

// Strings sorts a slice of strings in increasing order.
func Strings(x []string) { Sort(StringSlice(x)) }

// IntsAreSorted reports whether the slice x is sorted in increasing order.
func IntsAreSorted(x []int) bool { return IsSorted(IntSlice(x)) }

// Float64sAreSorted reports whether the slice x is sorted in increasing order,
// with not-a-number (NaN) values before any other values.
func Float64sAreSorted(x []float64) bool { return IsSorted(Float64Slice(x)) }

// StringsAreSorted reports whether the slice x is sorted in increasing order.
func StringsAreSorted(x []string) bool { return IsSorted(StringSlice(x)) }

// 举个栗子
func main() {
	s := []int{1,2,1}
	sort.Ints(s)
	fmt.Println(s) // 1,1,2
}

// 注意上面几个方法都是非稳定排序的
// 那如果要用稳定排序怎么办呢
// sort也提供了几个自定义类型，如下
type IntSlice []int

func (x IntSlice) Len() int           { return len(x) }
func (x IntSlice) Less(i, j int) bool { return x[i] < x[j] }
func (x IntSlice) Swap(i, j int)      { x[i], x[j] = x[j], x[i] }

// Sort is a convenience method: x.Sort() calls Sort(x).
func (x IntSlice) Sort() { Sort(x) }

// Float64Slice implements Interface for a []float64, sorting in increasing order,
// with not-a-number (NaN) values ordered before other values.
type Float64Slice []float64

func (x Float64Slice) Len() int { return len(x) }

// Less reports whether x[i] should be ordered before x[j], as required by the sort Interface.
// Note that floating-point comparison by itself is not a transitive relation: it does not
// report a consistent ordering for not-a-number (NaN) values.
// This implementation of Less places NaN values before any others, by using:
//
//	x[i] < x[j] || (math.IsNaN(x[i]) && !math.IsNaN(x[j]))
//
func (x Float64Slice) Less(i, j int) bool { return x[i] < x[j] || (isNaN(x[i]) && !isNaN(x[j])) }
func (x Float64Slice) Swap(i, j int)      { x[i], x[j] = x[j], x[i] }

// isNaN is a copy of math.IsNaN to avoid a dependency on the math package.
func isNaN(f float64) bool {
	return f != f
}

// Sort is a convenience method: x.Sort() calls Sort(x).
func (x Float64Slice) Sort() { Sort(x) }

// StringSlice attaches the methods of Interface to []string, sorting in increasing order.
type StringSlice []string

func (x StringSlice) Len() int           { return len(x) }
func (x StringSlice) Less(i, j int) bool { return x[i] < x[j] }
func (x StringSlice) Swap(i, j int)      { x[i], x[j] = x[j], x[i] }

// Sort is a convenience method: x.Sort() calls Sort(x).
func (x StringSlice) Sort() { Sort(x) }

// 再举个栗子(稳定排序)
func main() {
	s := []int{1,2,1}
	sort.Stable(sort.IntSlice(s))
	fmt.Println(s) // 1,1,2
}
```
### 总结
不得不说，代码性能极致和可读性真是不可兼得，这sort包写的，啃得我牙都碎了~