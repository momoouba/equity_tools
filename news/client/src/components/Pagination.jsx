import React, { useState, useEffect } from 'react'
import './Pagination.css'

function Pagination({ currentPage, totalPages, onPageChange, totalItems }) {
  const [pageRange, setPageRange] = useState({ start: 1, end: 5 })
  const [pageInput, setPageInput] = useState('')

  // 计算要显示的页码
  const getPageNumbers = () => {
    if (totalPages <= 10) {
      // 如果总页数不超过10页，显示所有页码
      return Array.from({ length: totalPages }, (_, i) => i + 1)
    }

    const { start, end } = pageRange
    const pages = []
    
    // 添加前面的页码
    for (let i = start; i <= Math.min(start + 4, end - 1); i++) {
      pages.push(i)
    }
    
    // 如果有省略号，添加省略号
    if (end - start > 5) {
      pages.push('ellipsis')
    }
    
    // 添加后面的页码
    for (let i = Math.max(end - 4, start + 1); i <= end; i++) {
      if (!pages.includes(i)) {
        pages.push(i)
      }
    }
    
    return pages
  }

  // 处理页码点击
  const handlePageClick = (page) => {
    if (page === 'ellipsis') {
      // 点击省略号，跳转5页
      const { start, end } = pageRange
      const midPoint = Math.floor((start + end) / 2)
      const newStart = Math.max(1, midPoint - 2)
      const newEnd = Math.min(totalPages, newStart + 9)
      setPageRange({ start: newStart, end: newEnd })
    } else {
      onPageChange(page)
      // 如果当前页超出显示范围，调整显示范围
      const { start, end } = pageRange
      if (page < start || page > end) {
        if (page < start) {
          // 向前移动
          const newStart = Math.max(1, page - 4)
          const newEnd = Math.min(totalPages, newStart + 9)
          setPageRange({ start: newStart, end: newEnd })
        } else {
          // 向后移动
          const newEnd = Math.min(totalPages, page + 4)
          const newStart = Math.max(1, newEnd - 9)
          setPageRange({ start: newStart, end: newEnd })
        }
      }
    }
  }

  // 处理上一页
  const handlePrevPage = () => {
    if (currentPage > 1) {
      const newPage = currentPage - 1
      onPageChange(newPage)
      // 如果新页超出显示范围，调整显示范围
      const { start } = pageRange
      if (newPage < start) {
        const newStart = Math.max(1, newPage - 4)
        const newEnd = Math.min(totalPages, newStart + 9)
        setPageRange({ start: newStart, end: newEnd })
      }
    }
  }

  // 处理下一页
  const handleNextPage = () => {
    if (currentPage < totalPages) {
      const newPage = currentPage + 1
      onPageChange(newPage)
      // 如果新页超出显示范围，调整显示范围
      const { end } = pageRange
      if (newPage > end) {
        const newEnd = Math.min(totalPages, newPage + 4)
        const newStart = Math.max(1, newEnd - 9)
        setPageRange({ start: newStart, end: newEnd })
      }
    }
  }

  // 当总页数变化时，重置显示范围
  useEffect(() => {
    if (totalPages > 0) {
      const initialEnd = Math.min(10, totalPages)
      setPageRange({ start: 1, end: initialEnd })
    }
  }, [totalPages])

  // 当当前页变化时，更新输入框的值
  useEffect(() => {
    setPageInput(currentPage.toString())
  }, [currentPage])

  // 处理页码输入跳转
  const handlePageInputChange = (e) => {
    const value = e.target.value
    // 只允许输入数字
    if (value === '' || /^\d+$/.test(value)) {
      setPageInput(value)
    }
  }

  // 处理跳转到指定页
  const handleGoToPage = () => {
    const page = parseInt(pageInput)
    if (page && page >= 1 && page <= totalPages) {
      onPageChange(page)
      // 如果跳转的页超出显示范围，调整显示范围
      const { start, end } = pageRange
      if (page < start || page > end) {
        if (page < start) {
          // 向前移动
          const newStart = Math.max(1, page - 4)
          const newEnd = Math.min(totalPages, newStart + 9)
          setPageRange({ start: newStart, end: newEnd })
        } else {
          // 向后移动
          const newEnd = Math.min(totalPages, page + 4)
          const newStart = Math.max(1, newEnd - 9)
          setPageRange({ start: newStart, end: newEnd })
        }
      }
    } else {
      alert(`请输入1到${totalPages}之间的页码`)
      setPageInput(currentPage.toString())
    }
  }

  // 处理输入框回车
  const handlePageInputKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleGoToPage()
    }
  }

  if (totalPages <= 1) {
    return null
  }

  return (
    <div className="pagination">
      <button
        disabled={currentPage === 1}
        onClick={handlePrevPage}
      >
        上一页
      </button>
      <div className="pagination-pages">
        {getPageNumbers().map((page, index) => {
          if (page === 'ellipsis') {
            return (
              <button
                key={`ellipsis-${index}`}
                className="pagination-ellipsis"
                onClick={() => handlePageClick('ellipsis')}
              >
                …
              </button>
            )
          }
          return (
            <button
              key={page}
              className={`pagination-page ${currentPage === page ? 'active' : ''}`}
              onClick={() => handlePageClick(page)}
            >
              {page}
            </button>
          )
        })}
      </div>
      <span className="pagination-info">
        第 {currentPage} 页，共 {totalPages} 页
        {typeof totalItems === 'number' ? `，共 ${totalItems} 条数据` : ''}
      </span>
      <div className="pagination-goto">
        <span>跳转到</span>
        <input
          type="text"
          className="pagination-input"
          value={pageInput}
          onChange={handlePageInputChange}
          onKeyPress={handlePageInputKeyPress}
          placeholder="页码"
        />
        <span>页</span>
        <button
          className="pagination-goto-btn"
          onClick={handleGoToPage}
        >
          确定
        </button>
      </div>
      <button
        disabled={currentPage === totalPages}
        onClick={handleNextPage}
      >
        下一页
      </button>
    </div>
  )
}

export default Pagination

